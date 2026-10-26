import { describe, expect, it, vi } from 'vitest';
import type { PreparedCandidate } from '@/application/report-history/report-candidate';
import { yearMonth } from '@/domain/shared/year-month';
import { acceptPreparedCandidate, confirmationAttemptForClick, fetchArchivedDocument, revisionForCycle,
  attemptAfterFailureResponse } from './report-confirmation-state';

const candidate = { candidateId: 'candidate-A', documentHash: 'hash', basis: {} as PreparedCandidate['basis'], inputGeneration: '1',
  document: { schemaVersion: 1 as const, templateVersion: 'report@e3a8f9e', contentHash: 'hash', json: { value: 2, nested: { a: 1, b: 2 } }, historyCalculationIds: [] } };

describe('candidate response gate', () => {
  it('drops a late A response after B was applied', () => {
    expect(acceptPreparedCandidate('B', 'A', candidate, { value: 2 }, () => 'key')).toBeNull();
  });
  it('accepts structurally identical documents despite JSON property order', () => {
    expect(acceptPreparedCandidate('A', 'A', candidate, { nested: { b: 2, a: 1 }, value: 2 }, () => 'same-click'))
      .toMatchObject({ key: 'A', candidate, previewRequired: false, idempotencyKey: 'same-click' });
  });
  it('requires a fresh explicit click when the server document differs', () => {
    expect(acceptPreparedCandidate('A', 'A', candidate, { value: 1, nested: { a: 1, b: 2 } }, () => 'same-click'))
      .toMatchObject({ key: 'A', candidate, previewRequired: true });
  });
});

it('reads an old monthly revision from a complete 51-item list and treats failed loading as unknown', () => {
  const old = yearMonth(2020, 1);
  const list = Array.from({ length: 51 }, (_, index) => ({ reportCycle: index === 0 ? old : yearMonth(2026, 8), revision: index === 0 ? 2 : 1 }));
  expect(revisionForCycle(list, true, old)).toBe(2);
  expect(revisionForCycle(list, false, old)).toBeNull();
});

it('suspends new backfill steps when a stored document opens, and leaves failed opens alone', async () => {
  const cancel = vi.fn();
  const historySources = { construction: { confirmed: 1, backfill: 0, unconfirmed: 0, current: 0 }, funding: { confirmed: 0, backfill: 1, unconfirmed: 0, current: 0 } };
  const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ document: candidate.document, historySources }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'CONFIRMATION_NOT_FOUND' }) });
  expect(await fetchArchivedDocument('id 1', cancel, request as unknown as typeof fetch)).toEqual({ document: candidate.document, historySources });
  expect(request).toHaveBeenCalledWith('/api/report-history/confirmations?confirmationId=id%201', { cache: 'no-store' });
  expect(cancel).toHaveBeenCalledTimes(1);
  await expect(fetchArchivedDocument('missing', cancel, request as unknown as typeof fetch)).rejects.toThrow('CONFIRMATION_NOT_FOUND');
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('two archived revisions return their own document and source counts without retaining dashboard selection', async () => {
  const cancel = vi.fn();
  const first = { document: candidate.document, historySources: { construction: { confirmed: 1, backfill: 0, unconfirmed: 0, current: 0 }, funding: { confirmed: 0, backfill: 0, unconfirmed: 0, current: 0 } } };
  const second = { document: { ...candidate.document, json: { value: 3 } }, historySources: { construction: { confirmed: 0, backfill: 2, unconfirmed: 0, current: 0 }, funding: { confirmed: 1, backfill: 0, unconfirmed: 0, current: 0 } } };
  const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => first }).mockResolvedValueOnce({ ok: true, json: async () => second });
  expect(await fetchArchivedDocument('first', cancel, request as unknown as typeof fetch)).toEqual(first);
  expect(await fetchArchivedDocument('second', cancel, request as unknown as typeof fetch)).toEqual(second);
  expect(cancel).toHaveBeenCalledTimes(2);
});

it('reuses the original candidate, revision, and key after an ambiguous storage failure', () => {
  const first = confirmationAttemptForClick(null, 'input-A', 'candidate-A', 2, 'click-A', '정정 사유');
  expect(confirmationAttemptForClick(first, 'input-A', 'candidate-B', 3, 'click-B', '새 사유')).toBe(first);
  expect(confirmationAttemptForClick(first, 'input-B', 'candidate-B', 3, 'click-B', '새 사유'))
    .toEqual({ key: 'input-B', candidateId: 'candidate-B', expectedRevision: 3, idempotencyKey: 'click-B', correctionReason: '새 사유' });
});

it('drops a definite 422 command so a corrected reason is submitted, but preserves a 503 retry', () => {
  const invalid = confirmationAttemptForClick(null, 'input-A', 'candidate-A', 2, 'click-A', '가'.repeat(2001));
  const rejected = attemptAfterFailureResponse(invalid, 422);
  expect(rejected).toBeNull();
  const corrected = confirmationAttemptForClick(rejected, 'input-A', 'candidate-A', 2, 'click-A', '수정한 사유');
  expect(corrected.correctionReason).toBe('수정한 사유');
  expect(attemptAfterFailureResponse(corrected, 503)).toBe(corrected);
});

it('늦은 A 내보내기 응답·다운로드 오류를 B 선택이나 새 A 선택에 붙이지 않는다', async () => {
  const state = await import('./report-confirmation-state') as unknown as { exportRequestMatches?: (current: { confirmationId: string; generation: number } | null,
    requested: { confirmationId: string; generation: number }) => boolean };
  const A = { confirmationId: 'A', generation: 1 }, B = { confirmationId: 'B', generation: 2 }, newA = { confirmationId: 'A', generation: 3 };
  expect(state.exportRequestMatches?.(B, A)).toBe(false);
  expect(state.exportRequestMatches?.(newA, A)).toBe(false);
  expect(state.exportRequestMatches?.(A, A)).toBe(true);
});

it('late old archived open cannot cancel current backfill or overwrite the newer document', async()=>{
 let resolveOld!:(response:Response)=>void;let generation=0;const cancel=vi.fn();let displayed:unknown=null;
 const request=vi.fn(async(id:string)=>id.includes('old')?new Promise<Response>(resolve=>{resolveOld=resolve;}):Response.json({document:{...candidate.document,json:{value:'new'}},historySources:{construction:{confirmed:2}}}));
 const open=async(id:string)=>{const token=++generation;const data=await fetchArchivedDocument(id,cancel,request as never,()=>token===generation);if(token===generation)displayed=data;};
 const old=open('old');await open('new');const newest=displayed;resolveOld(Response.json({document:candidate.document,historySources:{construction:{confirmed:1}}}));await old;
 expect(displayed).toBe(newest);expect(cancel).toHaveBeenCalledTimes(1);
});
