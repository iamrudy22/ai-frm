import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import contract from '../../../scripts/hwpx-sample/fixtures/report-contract.json';
import type { FinancialReport } from './report-model';
import { collectAssetBytes, collectReportHwpxAssets, HwpxChartFigures } from './report-hwpx-assets';

const png = () => new Uint8Array([137,80,78,71,13,10,26,10,1]);
it('captures existing whole figures including empty notices and preserves the print reason rule without changing the input', () => {
  const report = structuredClone(contract.report) as unknown as FinancialReport;
  const source = structuredClone(report);
  const html = renderToStaticMarkup(<HwpxChartFigures report={report}/>);
  expect(html.match(/<figure/g)).toHaveLength(5);
  for (const metric of report.metrics) expect(html).toContain(metric.title);
  expect(html).toContain('report-metric-chart');
  expect(html).not.toContain('숨긴 부가 경고');
  expect(html.match(/<svg/g)).toHaveLength(1);
  expect(html).toContain('위기');
  expect(report).toEqual(source);
});
it('keeps titles and the existing Unicode failure summary when all five figures have no SVG', () => {
  const reason = `${'가'.repeat(58)}😀남은 긴 문구`.repeat(2);
  const report = { ...contract.report, metrics: contract.report.metrics.map(metric => ({
    ...metric, status: '산출 불가', narrative: reason, points: [],
  })) } as unknown as FinancialReport;
  const html = renderToStaticMarkup(<HwpxChartFigures report={report}/>);
  expect(html.match(/<figure/g)).toHaveLength(5);
  expect(html).not.toContain('<svg');
  expect(html.match(/😀… \(상세는 HTML 참고\)/g)).toHaveLength(5);
  expect(html).not.toContain('남은 긴 문구');
  expect(report.metrics[0].narrative).toBe(reason);
});
it('collects five chart roles and two references once, copies the bytes and always releases the capture session', async () => {
  const original = png();
  const capture = vi.fn<(role: string) => Promise<Uint8Array>>(async () => original);
  const read = vi.fn<(role: string) => Promise<Uint8Array>>(async () => original);
  const close = vi.fn();
  const result = await collectAssetBytes({capture, close}, read);
  expect(capture.mock.calls.map(c => c[0])).toEqual(['recovery','liquidity','construction','funding','cash']);
  expect(read.mock.calls.map(c => c[0])).toEqual(['referenceRisk','referenceLcr']);
  expect(Object.keys(result)).toHaveLength(7);
  result.recovery[8] = 99;
  expect(original[8]).toBe(1);
  expect(result.liquidity[8]).toBe(1);
  expect(close).toHaveBeenCalledTimes(1);
});
it('releases the host on a capture or reference error and never returns partial assets', async () => {
  for (const failCapture of [true,false]) {
    const close = vi.fn();
    const capture = vi.fn(async () => {if(failCapture) throw new Error('capture failed'); return png();});
    const read = vi.fn(async () => {throw new Error('reference failed');});
    await expect(collectAssetBytes({capture,close},read)).rejects.toThrow(failCapture?'capture failed':'reference failed');
    expect(close).toHaveBeenCalledTimes(1);
  }
});
it('aborts a hanging capture promptly and releases the host', async () => {
  const controller = new AbortController();const close=vi.fn();
  const promise = collectAssetBytes({capture:()=>new Promise(()=>{}),close},async()=>png(),controller.signal);
  controller.abort();
  await expect(promise).rejects.toMatchObject({name:'AbortError'});
  expect(close).toHaveBeenCalledTimes(1);
});
it('rejects an empty or non-PNG capture with cleanup', async () => {
  const close=vi.fn();
  await expect(collectAssetBytes({capture:async()=>new Uint8Array(),close},async()=>png())).rejects.toThrow(/PNG/);
  expect(close).toHaveBeenCalledTimes(1);
});
it('cancels a pending capture-library chunk before creating any DOM host', async () => {
  let release!: (value: {toBlob: ReturnType<typeof vi.fn>}) => void;
  const pending = new Promise<{toBlob: ReturnType<typeof vi.fn>}>(resolve => {release=resolve;});
  vi.doMock('html-to-image', () => pending);
  const controller=new AbortController();
  try {
    const result=collectReportHwpxAssets(contract.report as unknown as FinancialReport, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({name:'AbortError'});
  } finally {release({toBlob:vi.fn()});vi.doUnmock('html-to-image');}
});
