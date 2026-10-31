import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportReportHwpx, type ReportHwpxAssets, type ReportImageRole } from './report-hwpx-export';
import { parseHwpxXml, readHwpxPackage, validateHwpxPackage } from './report-hwpx-package';
import type { FinancialReport } from './report-model';

const template = new Uint8Array(readFileSync('public/aifrm/hwpx/blank.hwpx'));
const fixture = JSON.parse(readFileSync('scripts/hwpx-sample/fixtures/report-contract.json', 'utf8'));
const png = new Uint8Array(readFileSync('src/app/aifrm/assets/reference-lcr-formula.png'));
const roles: readonly ReportImageRole[] = ['recovery', 'liquidity', 'construction', 'funding', 'cash', 'referenceRisk', 'referenceLcr'];
const assets = () => Object.fromEntries(roles.map((role) => [role, png.slice()])) as ReportHwpxAssets;
const response = () => new Response(template.slice().buffer);
afterEach(() => vi.unstubAllGlobals());

function installFetch() {
  vi.stubGlobal('DOMParser', class extends DOMParser {
    constructor() { super({ onError: (_level, message) => { throw new Error(message); } }); }
  });
  vi.stubGlobal('XMLSerializer', XMLSerializer);
  const fetch = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
describe('브라우저 HWPX 출력 조립', () => {
  it('원본 빈 template와 Apache 고지의 해시를 공개 복사본에서 보존한다', () => {
    const provenance = JSON.parse(readFileSync('public/aifrm/hwpx/template-provenance.json', 'utf8'));
    expect(template).toEqual(new Uint8Array(readFileSync('scripts/hwpx-sample/blank.hwpx')));
    const license = readFileSync('public/aifrm/hwpx/LICENSE-python-hwpx.txt');
    expect(license).toEqual(readFileSync('scripts/hwpx-sample/LICENSE-python-hwpx.txt'));
    expect(createHash('sha256').update(template).digest('hex')).toBe(provenance.blankSha256);
    expect(createHash('sha256').update(license).digest('hex')).toBe(provenance.licenseSha256);
    expect(provenance.webSourcePath).toBe('/aifrm/hwpx/blank.hwpx');
  });
  it('같은 snapshot의 본문·7그림·참조를 실제 ZIP Blob에 담고 원본/날짜를 보존한다', async () => {
    const fetch = installFetch();
    const report = structuredClone(fixture.report) as FinancialReport;
    const images = assets(), reportBefore = structuredClone(report), imagesBefore = structuredClone(images);
    const blob = await exportReportHwpx(report, images);
    expect(blob.type).toBe('application/hwp+zip');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(validateHwpxPackage(bytes)).toEqual([]);
    const parts = readHwpxPackage(bytes);
    const section = parseHwpxXml(parts['Contents/section0.xml'], 'Contents/section0.xml');
    const text = section.documentElement.textContent;
    expect(text).toContain(fixture.report.title);
    expect(text).toContain('(2026.10.29, 자금기획팀)');
    expect(text).toContain('현재시재 -17 억원입니다.');
    expect(text).toContain('20% × 분양회수 + 10% × 기타수입');
    expect(text).not.toContain('숨긴');
    const imageIds = Array.from(section.getElementsByTagNameNS('*', 'img')).map((node) => node.getAttribute('binaryItemIDRef'));
    expect(imageIds).toHaveLength(7);
    const manifest = parseHwpxXml(parts['Contents/content.hpf'], 'Contents/content.hpf');
    const items = Array.from(manifest.getElementsByTagNameNS('*', 'item'));
    for (const [index, role] of roles.entries()) {
      const item = items.find((node) => node.getAttribute('id') === imageIds[index]);
      expect(parts[item!.getAttribute('href')!]).toEqual(images[role]);
    }
    expect(report).toEqual(reportBefore); expect(images).toEqual(imagesBefore);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/aifrm/hwpx/blank.hwpx', {
      mode: 'same-origin', credentials: 'same-origin', redirect: 'error',
    });
    expect(new Uint8Array(await (await exportReportHwpx(report, images)).arrayBuffer())).toEqual(bytes);
  });
  it('template HTTP/네트워크/손상 실패 후 재시도 가능하며 성공 Blob을 반환하지 않는다', async () => {
    const fetch = installFetch();
    fetch.mockResolvedValueOnce(new Response('missing', { status: 404 }));
    await expect(exportReportHwpx(fixture.report as FinancialReport, assets())).rejects.toThrow(/template|템플릿/i);
    fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(exportReportHwpx(fixture.report as FinancialReport, assets())).rejects.toThrow(/offline/);
    fetch.mockResolvedValueOnce(new Response('corrupt zip'));
    await expect(exportReportHwpx(fixture.report as FinancialReport, assets())).rejects.toThrow(/ZIP/);
    await expect(exportReportHwpx(fixture.report as FinancialReport, assets())).resolves.toBeInstanceOf(Blob);
  });
  it('그림 누락/손상 또는 유효하지 않은 문서면 다운로드 Blob 생성에 실패한다', async () => {
    installFetch();
    const missing = assets() as Partial<Record<ReportImageRole, Uint8Array>>;
    delete missing.cash;
    await expect(exportReportHwpx(fixture.report as FinancialReport, missing as ReportHwpxAssets)).rejects.toThrow(/PNG|cash/);
    await expect(exportReportHwpx(fixture.report as FinancialReport, { ...assets(), cash: new Uint8Array([1]) })).rejects.toThrow(/PNG/);
    await expect(exportReportHwpx({ ...fixture.report, metrics: [] } as FinancialReport, assets())).rejects.toThrow();
  });
});
