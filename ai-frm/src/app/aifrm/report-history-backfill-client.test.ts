import { describe, expect, it } from 'vitest';
import { advanceHistorySelectionRevision, canStartHistoryBackfill, historySelectionKey, runHistorySteps } from './report-history-backfill-client';
import type { HistoryBatch } from './report-history-backfill-client';

const batch: HistoryBatch = { batchId: 'batch', startKey: 'key', scopeId: 'default', fromCycle: '2026/08', toCycle: '2026/09', completedCycles: [], pendingCycles: ['2026/08', '2026/09'], status: 'running' };
describe('backfill resume client', () => {
  it('permits partial readable rounds when the latest report cycle is readable', () => {
    expect(canStartHistoryBackfill('2026/09', [{ round: '2026/06' }, { round: '2026/09' }])).toBe(true);
    expect(canStartHistoryBackfill('2026/09', [{ round: '2026/06' }, { round: '2026/08' }])).toBe(false);
  });
  it('requests a new immutable selection after a selected partial batch advances', () => {
    const before = historySelectionKey('input', '2026/09', '2026/07', '2026/09', 'batch', 0);
    const after = historySelectionKey('input', '2026/09', '2026/07', '2026/09', 'batch', 1);
    expect(before).not.toBe(after);
  });
  it('invalidates a partial batch cache even when that batch was deselected before resume', () => {
    const partialKey = historySelectionKey('input', '2026/09', '2026/07', '2026/09', 'batch', 0);
    const cache = new Map([[partialKey, { historySelectionId: 'selection-2', completed: 1 }]]);
    const revision = advanceHistorySelectionRevision(0, batch, { ...batch, completedCycles: ['2026/08', '2026/09'], pendingCycles: [], status: 'completed' });
    const completeKey = historySelectionKey('input', '2026/09', '2026/07', '2026/09', 'batch', revision);
    expect(completeKey).not.toBe(partialKey);
    expect(cache.get(completeKey)).toBeUndefined();
    cache.set(completeKey, { historySelectionId: 'selection-3', completed: 2 });
    expect(cache.get(partialKey)).toEqual({ historySelectionId: 'selection-2', completed: 1 });
    expect(cache.get(completeKey)).toEqual({ historySelectionId: 'selection-3', completed: 2 });
  });
  it('runs one cycle at a time and waits at least Retry-After before a 202 retry', async () => {
    const events: string[] = [];
    let calls = 0;
    const result = await runHistorySteps(batch, new AbortController().signal, {
      step: async () => { events.push('step'); calls++; return calls === 1 ? { status: 202, retryAfterSeconds: 1 } : { status: 200, batch: { ...batch, completedCycles: ['2026/08', '2026/09'], pendingCycles: [], status: 'completed' } }; },
      wait: async ms => { events.push(`wait:${ms}`); }, onBatch: () => {},
    });
    expect(events).toEqual(['step', 'wait:1000', 'step']);
    expect(result.status).toBe('completed');
  });
  it('stops on cancellation without starting another cycle', async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(runHistorySteps(batch, controller.signal, {
      step: async () => { calls++; controller.abort(); return { status: 202, retryAfterSeconds: 1 }; },
      wait: async () => {}, onBatch: () => {},
    })).rejects.toThrow('ABORTED');
    expect(calls).toBe(1);
  });
});
