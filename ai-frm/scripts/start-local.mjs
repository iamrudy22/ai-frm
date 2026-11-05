import { execFile, execSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const appDirectory = new URL('../', import.meta.url);
const { engines } = JSON.parse(readFileSync(new URL('package.json', appDirectory), 'utf8'));
const host = '127.0.0.1';
const port = 3002;
const appUrl = `http://${host}:${port}/aifrm`;
const nextCli = 'node_modules/next/dist/bin/next';

function checkPort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, host, () => probe.close(resolve));
  });
}

function runNext(...args) {
  const result = spawnSync(process.execPath, [nextCli, ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? (result.signal === 'SIGINT' ? 130 : 1);
}

async function openBrowserWhenReady(server, stopped) {
  const deadline = AbortSignal.any([stopped, AbortSignal.timeout(60_000)]);
  while (!deadline.aborted) {
    let ready = false;
    try {
      const response = await fetch(appUrl, {
        redirect: 'manual',
        signal: AbortSignal.any([deadline, AbortSignal.timeout(2_000)]),
      });
      await response.body?.cancel();
      ready = response.status === 200;
    } catch {
      // Keep checking while Next is starting.
    }

    if (ready && !deadline.aborted && server.exitCode === null && server.signalCode === null) {
      execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '""', `"${appUrl}"`], {
        windowsHide: true,
        windowsVerbatimArguments: true,
        timeout: 5_000,
      }, (error) => {
        if (error) console.warn(`브라우저를 자동으로 열지 못했습니다. ${appUrl} 을 직접 여세요.`);
      });
      return;
    }

    await delay(500, undefined, { signal: deadline }).catch(() => {});
  }
  if (!stopped.aborted) console.warn(`서버 준비 확인 시간이 지났습니다. 준비가 끝나면 ${appUrl} 을 직접 여세요.`);
}

async function startServer() {
  const server = spawn(process.execPath, [nextCli, 'start', '--hostname', host, '--port', String(port)], {
    stdio: 'inherit',
  });
  const stopped = new AbortController();
  const exit = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', (status, signal) => resolve(status ?? (signal === 'SIGINT' ? 130 : 1)));
  }).finally(() => stopped.abort());

  const browser = process.argv.includes('--open-browser')
    ? openBrowserWhenReady(server, stopped.signal)
    : Promise.resolve();
  const [status] = await Promise.all([exit, browser]);
  return status;
}

try {
  if (process.versions.node !== engines.node) {
    throw new Error(`Node.js ${engines.node}이 필요합니다. 현재 버전은 ${process.version}입니다.`);
  }
  process.chdir(fileURLToPath(appDirectory));
  await checkPort();

  if (!existsSync(nextCli)) {
    console.log('프로젝트 의존성을 설치합니다.');
    execSync('npm ci --include=dev --include=optional', { stdio: 'inherit' });
  }

  console.log('AIFRM을 빌드합니다.');
  process.exitCode = runNext('build', '--webpack');
  if (process.exitCode === 0) {
    await checkPort();
    console.log(`AIFRM 주소: ${appUrl} · 종료: Ctrl+C`);
    process.exitCode = await startServer();
  }
} catch (error) {
  console.error(error.code === 'EADDRINUSE'
    ? `${port} 포트가 사용 중입니다. 기존 서버를 확인한 뒤 다시 실행하세요.`
    : error.message);
  process.exitCode = error.status || 1;
}
