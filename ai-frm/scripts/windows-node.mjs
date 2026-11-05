import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

// From https://nodejs.org/dist/v26.12.1/SHASUMS256.txt.
// Update the checksums when package.json pins a different version.
const checksums = new Map([
  ['node-v26.12.1-win-x64', 'b3efd5c70cba3308ed46e7e699a9b8aac075bbc6b027fcb39c84c31acc25e2b4'],
  ['node-v26.12.1-win-arm64', '34567581ee63967b37afb6b7a0cc63a2d550a43d5d838adb75982d7e356f2e2c'],
]);

function checkRuntime(directory, version) {
  const executable = join(directory, 'node.exe');
  const npm = join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(executable) || !existsSync(npm)) {
    throw new Error(`AIFRM 전용 Node.js 설치가 불완전합니다. ${directory} 폴더를 지우고 다시 실행하세요.`);
  }
  const actualVersion = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim();
  if (actualVersion !== `v${version}`) {
    throw new Error(`AIFRM 전용 Node.js 버전이 맞지 않습니다. ${directory} 폴더를 지우고 다시 실행하세요.`);
  }
  return executable;
}

export async function installWindowsNode(version) {
  const distribution = `node-v${version}-win-${process.arch}`;
  const expectedChecksum = checksums.get(distribution);
  if (!expectedChecksum) throw new Error(`Node.js ${version} Windows ${process.arch} 자동 설치를 지원하지 않습니다.`);

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData || !isAbsolute(localAppData)) throw new Error('Windows의 LOCALAPPDATA 경로를 찾을 수 없습니다.');

  const cache = join(localAppData, 'AIFRM', 'runtime');
  const installed = join(cache, distribution);
  if (existsSync(installed)) return checkRuntime(installed, version);

  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(join(cache, 'download-'));
  try {
    console.log(`AIFRM 전용 Node.js ${version}을 다운로드합니다. 첫 실행에는 인터넷이 필요합니다.`);
    const filename = `${distribution}.zip`;
    const response = await fetch(`https://nodejs.org/dist/v${version}/${filename}`, {
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Node.js 다운로드에 실패했습니다. HTTP ${response.status}`);
    }
    const archive = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(archive).digest('hex') !== expectedChecksum) {
      throw new Error('Node.js 다운로드 파일의 SHA-256이 공식 배포본과 다릅니다.');
    }

    const archivePath = join(temporary, filename);
    await writeFile(archivePath, archive);
    const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-xf', archivePath, '-C', temporary], { stdio: 'inherit', windowsHide: true });
    const extracted = join(temporary, distribution);
    checkRuntime(extracted, version);
    try {
      await rename(extracted, installed);
    } catch (error) {
      // Another launcher may have published the same runtime during the download.
      if (!existsSync(installed)) throw error;
      return checkRuntime(installed, version);
    }
    return join(installed, 'node.exe');
  } finally {
    await rm(temporary, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
