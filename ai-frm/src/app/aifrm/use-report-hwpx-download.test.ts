import { afterEach, expect, it, vi } from 'vitest';
import { buildFinancialReport, type FinancialReport } from './report-model';

const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock('react'); vi.doUnmock('./report-hwpx-assets'); vi.doUnmock('./report-hwpx-export'); vi.resetModules(); });

async function screen() {
  vi.resetModules();
  const states: unknown[] = [], refs: { current: unknown }[] = [], cleanups: (() => void)[] = [];
  let si = 0, ri = 0, mounted = false, updates = 0;
  vi.doMock('react', async original => ({ ...await original<typeof import('react')>(),
    useState: (initial: unknown) => { const index = si++; if (!(index in states)) states[index] = initial;
      return [states[index], (next: unknown) => { updates++; states[index] = next; }]; },
    useRef: (initial: unknown) => refs[ri++] ?? (refs[ri - 1] = { current: initial }),
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void | (() => void)) => { if (!mounted) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } },
  }));
  const collect = vi.fn(async (_report: FinancialReport, _signal?: AbortSignal) => { void _report; void _signal; return { charts: 'snapshot charts' }; });
  const exported = vi.fn(async (_report: FinancialReport, _assets: unknown) => { void _report; void _assets; return new Blob(['hwpx']); });
  const loaded: string[] = [];
  vi.doMock('./report-hwpx-assets', () => { loaded.push('assets'); return { collectReportHwpxAssets: collect }; });
  vi.doMock('./report-hwpx-export', () => { loaded.push('export'); return { exportReportHwpx: exported }; });
  const click = vi.fn(), remove = vi.fn(), append = vi.fn();
  const anchor = { href: '', download: '', click, remove };
  const create = vi.fn(() => 'blob:synthetic'), revoke = vi.fn();
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild: append } });
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const mod = await import('./use-report-hwpx-download');
  expect(mod, 'click-only HWPX download hook must exist').not.toBeNull();
  const render = (report: FinancialReport | null) => { si = ri = 0; const result = mod!.useReportHwpxDownload(report); mounted = true; return result; };
  return { render, collect, exported, click, anchor, remove, create, revoke, fetch, loaded,
    updates: () => updates, unmount: () => cleanups.forEach(cleanup => cleanup()) };
}

it('does nothing on mount/null; explicit click freezes nested report and locks immediate duplicate clicks without API writes', async () => {
  vi.useFakeTimers(); const env = await screen(); const report = { ...buildFinancialReport(), reportMonth: '2026/08' };
  expect(env.render(report).isDownloadingHwpx).toBe(false); expect(env.collect).not.toHaveBeenCalled(); expect(env.exported).not.toHaveBeenCalled(); expect(env.loaded).toEqual([]);
  await env.render(null).downloadHwpx(); expect(env.collect).not.toHaveBeenCalled();
  const pending = deferred<{ charts: string }>(); env.collect.mockReturnValueOnce(pending.promise);
  const handler = env.render(report).downloadHwpx; const first = handler(); const second = handler();
  report.metrics[0].narrative = 'changed after click'; report.reportMonth = '2026/09';
  expect(env.render(report).isDownloadingHwpx).toBe(true);
  await vi.waitFor(() => expect(env.collect).toHaveBeenCalledTimes(1));
  const snapshot = env.collect.mock.calls[0][0]; expect(snapshot).not.toBe(report); expect(snapshot.reportMonth).toBe('2026/08');
  expect(snapshot.metrics[0].narrative).not.toBe('changed after click');
  pending.resolve({ charts: 'snapshot charts' }); await Promise.all([first, second]);
  expect(env.exported).toHaveBeenCalledWith(snapshot, { charts: 'snapshot charts' }); expect(env.click).toHaveBeenCalledTimes(1);
  expect(env.anchor.download).toContain('2026-08'); expect(env.anchor.download).toMatch(/\.hwpx$/); expect(env.anchor.download).not.toMatch(/[\\/:*?"<>|]/);
  expect(env.remove).toHaveBeenCalledTimes(1); await vi.runAllTimersAsync(); expect(env.revoke).toHaveBeenCalledWith('blob:synthetic');
  expect(env.render(report).isDownloadingHwpx).toBe(false); expect(env.fetch).not.toHaveBeenCalled(); env.unmount();
});

it.each(['assets', 'export'] as const)('%s failure shows retryable error with no download; successful retry clears it', async stage => {
  const env = await screen(); const report = buildFinancialReport();
  if (stage === 'assets') env.collect.mockRejectedValueOnce(Error('synthetic asset failure'));
  else env.exported.mockRejectedValueOnce(Error('synthetic ZIP failure'));
  await env.render(report).downloadHwpx(); const failed = env.render(report);
  expect(failed.isDownloadingHwpx).toBe(false); expect(failed.hwpxDownloadError).toContain('다시'); expect(env.click).not.toHaveBeenCalled(); expect(env.create).not.toHaveBeenCalled();
  await failed.downloadHwpx(); expect(env.render(report).hwpxDownloadError).toBeNull(); expect(env.click).toHaveBeenCalledTimes(1); env.unmount();
});

it.each(['assets', 'export'] as const)('unmount aborts %s in flight and suppresses late URL/error/state updates', async stage => {
  const env = await screen(); const pending = deferred<never>(); const report = buildFinancialReport();
  if (stage === 'assets') env.collect.mockReturnValueOnce(pending.promise); else env.exported.mockReturnValueOnce(pending.promise);
  const running = env.render(report).downloadHwpx();
  await vi.waitFor(() => expect(stage === 'assets' ? env.collect : env.exported).toHaveBeenCalledTimes(1));
  const signal = env.collect.mock.calls[0][1]!; env.unmount(); expect(signal.aborted).toBe(true); const updates = env.updates();
  pending.reject(Error('late synthetic error')); await running;
  expect(env.create).not.toHaveBeenCalled(); expect(env.click).not.toHaveBeenCalled(); expect(env.updates()).toBe(updates);
});

it('unmount promptly releases a completed download URL before its deferred cleanup', async () => {
  vi.useFakeTimers(); const env = await screen(); await env.render(buildFinancialReport()).downloadHwpx();
  env.unmount(); expect(env.revoke).toHaveBeenCalledWith('blob:synthetic'); await vi.runAllTimersAsync(); expect(env.revoke).toHaveBeenCalledTimes(1);
});


it('a successful export resolving after unmount cannot trigger a download or leave an object URL', async () => {
  const env = await screen(); const pending = deferred<Blob>(); env.exported.mockReturnValueOnce(pending.promise);
  const running = env.render(buildFinancialReport()).downloadHwpx();
  await vi.waitFor(() => expect(env.exported).toHaveBeenCalledTimes(1)); env.unmount(); const updates = env.updates();
  pending.resolve(new Blob(['late hwpx'])); await running;
  expect(env.create).not.toHaveBeenCalled(); expect(env.click).not.toHaveBeenCalled(); expect(env.updates()).toBe(updates);
});
