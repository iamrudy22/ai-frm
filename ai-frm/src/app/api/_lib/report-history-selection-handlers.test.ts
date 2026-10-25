import { describe, expect, it } from 'vitest';
import { parseYearMonth as ym } from '@/domain/shared/year-month';
import type { ExternalHistorySelection, HistoryRepository } from '@/application/report-history/ports';
import { handleHistorySelectionGet, handleHistorySelectionPost } from './report-history-selection-handlers';

const url = 'http://localhost:3000/api/report-history/selection';
const id = '11111111-1111-4111-8111-111111111111';
const selection: ExternalHistorySelection = { historySelectionId: id, scopeId: 'default', calculationVersion: 'risk-policy-2026-09-28@e3a8f9e', anchors: { construction: ym('2026/06'), funding: ym('2026/08') }, cutoff: '2026-10-23T00:00:00.000Z', selectedBackfillBatchId: null, headRevisions: [], historyCalculationIds: ['c'], calculations: [{ calculationId: 'c', scopeId: 'default', indicator: 'construction', origin: 'reconstructed', derivation: { kind: 'captured' }, effectiveMonth: ym('2026/06'), requestContext: null, inputHash: 'x', calculationVersion: 'risk-policy-2026-09-28@e3a8f9e', captureIds: [], resultJson: { encoded: 'hidden' }, evaluatedAt: '2026-10-23T00:00:00.000Z', evaluationClockTrace: [], evaluatedCalendar: { year: 2026, month: 10, day: 23 }, evaluationTimeZone: 'Asia/Seoul', createdAt: '2026-10-23T00:00:00.000Z' }] };
const body = { reportCycle: '2026/09', constructionBaseMonth: '2026/06', gapMonth: '2026/08', selectedBackfillBatchId: null };
const post = (value: unknown) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

describe('immutable history selection HTTP boundary', () => {
  it.each([
    ['BATCH_RANGE_MISMATCH', 422, 'BATCH_RANGE_MISMATCH'],
    ['BATCH_VERSION_MISMATCH', 422, 'BATCH_VERSION_MISMATCH'],
    ['UNSUPPORTED_CALCULATION_VERSION', 422, 'UNSUPPORTED_CALCULATION_VERSION'],
    ['NOT_FOUND_OR_WRONG_SCOPE', 404, 'HISTORY_NOT_FOUND'],
  ] as const)('maps %s to a permanent safe response without Retry-After', async (repositoryError, expectedStatus, expectedCode) => {
    const repository = { createHistorySelection: async () => { throw Error(repositoryError); } } as unknown as HistoryRepository;
    const provider = async () => ({ scopeId: 'default', repository, decode: () => null, now: () => new Date('2026-10-23T00:00:00.000Z') });
    const response = await handleHistorySelectionPost(post({ ...body, selectedBackfillBatchId: id }), provider);
    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get('retry-after')).toBeNull();
    expect(await response.json()).toEqual({ ok: false, code: expectedCode });
  });
  it('keeps a genuine storage failure retryable', async () => {
    const provider = async () => { throw Error('SQLITE_BUSY'); };
    const response = await handleHistorySelectionPost(post(body), provider);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await response.json()).toEqual({ ok: false, code: 'STORAGE_UNAVAILABLE' });
  });
  it('uses one server cutoff/scope/version and returns only decoded plain points', async () => {
    let query: unknown;
    const repository = { createHistorySelection: async (value: unknown) => { query = value; return selection; }, getHistorySelection: async () => selection } as unknown as HistoryRepository;
    const provider = async () => ({ scopeId: 'default', repository, decode: () => ({ ok: true, value: { result: { kind: 'ok', month: ym('2026/06'), index: 0 } } }), now: () => new Date('2026-10-23T00:00:00.000Z') });
    const response = await handleHistorySelectionPost(post(body), provider);
    expect(response.status).toBe(200);
    expect(query).toMatchObject({ scopeId: 'default', calculationVersion: selection.calculationVersion, asOf: selection.cutoff, basis: { reportCycle: ym('2026/09'), constructionBaseMonth: ym('2026/06'), fundingObservedMonth: ym('2026/08'), gapMonth: ym('2026/08') } });
    const json = await response.json();
    expect(json.view.points).toEqual([{ calculationId: 'c', indicator: 'construction', origin: 'reconstructed', unit: 'index', point: { month: ym('2026/06'), kind: 'available', value: 0 } }]);
    expect(JSON.stringify(json)).not.toContain('encoded');
    const again = await handleHistorySelectionGet(new Request(`${url}?historySelectionId=${id}`), provider);
    expect((await again.json()).view).toEqual(json.view);
  });
  it('rejects caller supplied scope, version, cutoff, or foreign origin', async () => {
    const provider = async (): Promise<never> => { throw Error('PROVIDER_SHOULD_NOT_RUN'); };
    for (const key of ['scopeId', 'calculationVersion', 'asOf']) {
      expect((await handleHistorySelectionPost(post({ ...body, [key]: 'forged' }), provider)).status).toBe(400);
    }
    expect((await handleHistorySelectionPost(new Request(url, { method: 'POST', headers: { origin: 'https://other.test' }, body: JSON.stringify(body) }), provider)).status).toBe(403);
  });
});
