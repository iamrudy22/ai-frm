import { describe, expect, it } from 'vitest';
import { handleBackfillGet, handleBackfillPost } from './report-history-handlers';
import type { HistoryDependencies, StoredBatch } from '../../../application/report-history/ports';
import { parseYearMonth } from '../../../domain/shared/year-month';

const url = 'http://localhost:3000/api/report-history/backfill';
const round = { round: '2026/09', sheetStart: '2026/09', actuals: [], plans: ['09', '10', '11', '12'].map(month => ({ month: `2026/${month}`, value: 1 })) };
const body = { action: 'plan', fromCycle: '2026/08', toCycle: '2026/08', rounds: [round] };
const provider = async (): Promise<never> => { throw Error('PROVIDER_SHOULD_NOT_RUN'); };
function post(value: unknown, headers?: HeadersInit): Request { return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) }); }
describe('backfill HTTP boundary', () => {
  it('plans without touching storage and derives the anchor from uploaded rounds', async () => {
    const response = await handleBackfillPost(post(body), provider);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).plan).toMatchObject({ anchorCycle: '2026/09', cycles: ['2026/08'] });
    expect((await handleBackfillPost(post({ ...body, rounds: [] }), provider)).status).toBe(422);
  });
  it('rejects foreign origins and oversized bodies before a provider is opened', async () => {
    expect((await handleBackfillPost(post(body, { origin: 'https://other.test' }), provider)).status).toBe(403);
    expect((await handleBackfillPost(post(body, { 'content-length': '1000001' }), provider)).status).toBe(413);
  });
  it('uses the loopback Host authority when Next normalizes the request URL', async () => {
    const normalizedUrl = 'http://localhost:3002/api/report-history/backfill';
    const request = (host: string | null, origin: string | null) => new Request(normalizedUrl, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(host ? { host } : {}), ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
    });
    expect((await handleBackfillPost(request('127.0.0.1:3002', 'http://127.0.0.1:3002'), provider)).status).toBe(200);
    expect((await handleBackfillPost(request(null, 'http://localhost:3002'), provider)).status).toBe(200);
    expect((await handleBackfillPost(request('127.0.0.1:3002', null), provider)).status).toBe(200);
    for (const [host, origin] of [
      ['evil.test:3002', 'http://evil.test:3002'],
      ['127.0.0.1:3002', 'http://evil.test:3002'],
      ['127.0.0.1:3002', 'http://127.0.0.1:3003'],
      ['127.0.0.1:3002', 'http://localhost:3002'],
    ]) expect((await handleBackfillPost(request(host, origin), provider)).status).toBe(403);
  });
  it('classifies malformed months and rounds as input errors and an overlong span as too large', async () => {
    expect((await handleBackfillPost(post({ ...body, fromCycle: 'bad' }), provider)).status).toBe(400);
    expect((await handleBackfillPost(post({ ...body, rounds: [{ ...round, plans: [] }] }), provider)).status).toBe(400);
    expect((await handleBackfillPost(post({ ...body, fromCycle: '2025/01' }), provider)).status).toBe(413);
  });
  it('maps a leased capture to a bounded 202 retry and exposes at most 20 active batches', async () => {
    const fixed = new Date('2026-10-23T00:00:00.000Z');
    const batchId = '22222222-2222-4222-8222-222222222222';
    const batch = { scopeId: 'default', batchId, startKey: '11111111-1111-4111-8111-111111111111', fromCycle: parseYearMonth('2026/08'), toCycle: parseYearMonth('2026/08'), inputHash: 'x', roundEntriesJson: [], fixedNow: fixed.toISOString(), evaluationTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, evaluatedCalendar: { year: fixed.getFullYear(), month: fixed.getMonth() + 1, day: fixed.getDate() }, completedCycles: [], pendingCycles: [parseYearMonth('2026/08')], status: 'pending-source' } satisfies StoredBatch;
    const deps = { repository: { getBatch: async () => batch, claimCaptureSlot: async () => ({ kind: 'busy' }), listBatches: async (_scope: string, _status: string, limit: number) => { expect(limit).toBe(20); return [batch]; } },
      metadataClock: () => fixed, decode: () => ({}), replayIndicators: () => ({}), replayYields: () => ({}) } as unknown as HistoryDependencies;
    const ready = async () => ({ scopeId: 'default', deps });
    const response = await handleBackfillPost(post({ action: 'step', batchId }), ready);
    expect(response.status).toBe(202);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await response.json()).toMatchObject({ ok: false, code: 'CAPTURE_BUSY', retryAfterSeconds: 1 });
    const active = await handleBackfillGet(new Request(`${url}?active=1`), ready);
    expect((await active.json()).batches).toHaveLength(1);
    expect((await handleBackfillGet(new Request(`${url}?batchId=${batchId}`), ready)).status).toBe(200);
  });
  it('recovers completed batches on a fresh all-list request while preserving the active-only contract', async () => {
    const fixed = new Date('2026-10-23T00:00:00.000Z');
    const base = { scopeId: 'default', batchId: '22222222-2222-4222-8222-222222222222', startKey: '11111111-1111-4111-8111-111111111111', fromCycle: parseYearMonth('2026/08'), toCycle: parseYearMonth('2026/08'), inputHash: 'x', roundEntriesJson: [], fixedNow: fixed.toISOString(), evaluationTimeZone: 'Asia/Seoul', evaluatedCalendar: { year: 2026, month: 10, day: 23 }, completedCycles: [parseYearMonth('2026/08')], pendingCycles: [], status: 'completed' } satisfies StoredBatch;
    const completed = base;
    const running = { ...base, batchId: '33333333-3333-4333-8333-333333333333', completedCycles: [], pendingCycles: [parseYearMonth('2026/08')], status: 'pending-source' } satisfies StoredBatch;
    const listed: string[] = [];
    const deps = { repository: { listBatches: async (scope: string, status: string, limit: number) => {
      expect(scope).toBe('default'); expect(limit).toBe(20); listed.push(status);
      return status === 'all' ? [completed, running] : [running];
    } } } as unknown as HistoryDependencies;
    const ready = async () => ({ scopeId: 'default', deps });
    const restored = await handleBackfillGet(new Request(`${url}?all=1`), ready);
    expect(restored.status).toBe(200);
    expect(restored.headers.get('cache-control')).toBe('no-store');
    expect((await restored.json()).batches.map((batch: StoredBatch) => batch.status)).toEqual(['completed', 'pending-source']);
    const active = await handleBackfillGet(new Request(`${url}?active=1`), ready);
    expect((await active.json()).batches.map((batch: StoredBatch) => batch.status)).toEqual(['pending-source']);
    expect(listed).toEqual(['all', 'active']);
  });
});
