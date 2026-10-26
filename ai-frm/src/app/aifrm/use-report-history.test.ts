import { expect, it, vi } from 'vitest';
import type { ExternalHistoryView } from '@/application/report-history/history-view';
import type { PreparedCandidate } from '@/application/report-history/report-candidate';
import { yearMonth } from '@/domain/shared/year-month';
import { invalidateHistorySelection } from './use-report-history';
import { historySelectionKey } from './report-history-backfill-client';
import * as confirmation from './report-confirmation-state';

it('correction refresh drops current preparation and reopening an old archive selects its exact document and sources', async () => {
  // Catch retaining a pre-correction candidate/key, or mixing current sources into an archived report.
  const old = { document: { schemaVersion: 1 as const, templateVersion: 'report@e3a8f9e', contentHash: 'old-hash',
    json: { value: 'old report', authoredAt: '2026-08-01T00:00:00.000Z' }, historyCalculationIds: ['old-construction', 'old-funding'] },
    historySources: { construction: { confirmed: 1, backfill: 2, unconfirmed: 3, current: 0 }, funding: { confirmed: 4, backfill: 5, unconfirmed: 6, current: 0 } } };
  const newer = { document: { ...old.document, contentHash: 'new-hash', json: { value: 'new report', authoredAt: '2026-10-27T00:00:00.000Z' }, historyCalculationIds: ['new-construction', 'new-funding'] },
    historySources: { construction: { confirmed: 7, backfill: 0, unconfirmed: 0, current: 1 }, funding: { confirmed: 8, backfill: 0, unconfirmed: 0, current: 1 } } };
  const request = vi.fn(async (url: string) => Response.json(url.includes('old%20id') ? old : newer));
  const cancel = vi.fn();
  const archived = await confirmation.fetchArchivedDocument('old id', cancel, request as unknown as typeof fetch);
  const initialDisplay = confirmation.reportDisplayOf(archived, null, newer.document.json, () => newer.historySources);
  expect(initialDisplay).toEqual({ report: old.document.json, sources: old.historySources });
  const snapshot = structuredClone({ ...archived, display: initialDisplay });
  const month = yearMonth(2026, 9), constructionMonth = yearMonth(2026, 7);
  let revision = 3;
  const key = () => historySelectionKey('input', month, constructionMonth, month, null, revision);
  const oldKey = key();
  const cache = new Map([[oldKey, { historySelectionId: 'old-selection' } as ExternalHistoryView]]);
  const candidate = { candidateId: 'old-candidate', documentHash: 'old-hash', document: old.document, basis: {} as PreparedCandidate['basis'], inputGeneration: '7' };
  const accepted = confirmation.acceptPreparedCandidate(oldKey, oldKey, candidate, old.document.json, () => 'old-click');
  const next = confirmation.correctionSuccessState({ candidateState: accepted, candidatePreparingKey: oldKey,
    confirmationKey: oldKey, candidatePreparationKey: oldKey, confirmationAttempt: { key: oldKey, candidateId: 'old-candidate', expectedRevision: 1, idempotencyKey: 'old-click' },
    confirmationConflictKey: oldKey, confirmed: { key: oldKey, id: 'old id' }, archived, appliedGeneration: 7, correctionRefreshRevision: 2 });
  expect(next).toMatchObject({ candidateState: null, candidatePreparingKey: null, confirmationKey: null, candidatePreparationKey: null,
    confirmationAttempt: null, confirmationConflictKey: null, confirmed: null, archived });
  // A delayed confirmation handler applies these to React's latest state, after a new upload advanced it.
  expect(next.appliedGeneration(8)).toBe(9);
  expect(next.correctionRefreshRevision(3)).toBe(4);
  invalidateHistorySelection(cache, () => { revision++; });
  expect(cache.size).toBe(0);
  expect(revision).toBe(4);
  expect(key()).not.toBe(oldKey);
  const currentView = { historySelectionId: 'new-selection' } as ExternalHistoryView;
  cache.set(key(), currentView);
  const freshCandidate = { ...candidate, candidateId: 'new-candidate', documentHash: 'new-hash', document: newer.document };
  expect(confirmation.acceptPreparedCandidate(key(), oldKey, candidate, newer.document.json, () => 'late')).toBeNull();
  const fresh = confirmation.acceptPreparedCandidate(key(), key(), freshCandidate, old.document.json, () => 'new-click');
  expect(fresh?.candidate.candidateId).toBe('new-candidate');
  const summarizeCurrent = vi.fn(() => newer.historySources);
  expect(confirmation.reportDisplayOf(null, fresh, old.document.json, summarizeCurrent)).toEqual({ report: newer.document.json, sources: newer.historySources });
  expect(summarizeCurrent).toHaveBeenCalledWith(newer.document.json);
  expect(confirmation.reportDisplayOf(next.archived, fresh, newer.document.json, summarizeCurrent)).toEqual(snapshot.display);
  const newArchive = await confirmation.fetchArchivedDocument('new id', cancel, request as unknown as typeof fetch);
  expect(confirmation.reportDisplayOf(newArchive, fresh, old.document.json, summarizeCurrent)).toEqual({ report: newer.document.json, sources: newer.historySources });
  const reopened = await confirmation.fetchArchivedDocument('old id', cancel, request as unknown as typeof fetch);
  const reopenedDisplay = confirmation.reportDisplayOf(reopened, fresh, newer.document.json, summarizeCurrent);
  expect({ ...reopened, display: reopenedDisplay }).toEqual(snapshot);
  expect(summarizeCurrent).toHaveBeenCalledTimes(1);
  expect(request.mock.calls).toEqual([
    ['/api/report-history/confirmations?confirmationId=old%20id', { cache: 'no-store' }],
    ['/api/report-history/confirmations?confirmationId=new%20id', { cache: 'no-store' }],
    ['/api/report-history/confirmations?confirmationId=old%20id', { cache: 'no-store' }],
  ]);
  expect(cancel).toHaveBeenCalledTimes(3);
});
