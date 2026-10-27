import { describe, expect, it } from 'vitest';
import { createManualEntry, saveManualEntry, prepareManualEntry, confirmManualEntry, type ManualEntryDependencies } from './manual-entry';
import { createBlankManualEntryContent, createManualEntryCatalog, manualEntryRequestHashInput, type StoredManualEntryDraft } from '../../domain/report-history/manual-entry';
import { SCORING_RULES } from '../../domain/risk/construction-perception/policy';
import { yearMonth } from '../../domain/shared/year-month';

// A prior successful ACK must be returned before a stale current revision/head is even read.
const hash = (value: unknown) => JSON.stringify(value);
const definitions = SCORING_RULES.filter(r => r.key !== '분양회수예측오차').map(r => ({ key: r.key as Exclude<typeof r.key, '분양회수예측오차'>, name: r.key, statistic: 'SYNTHETIC', items: ['SYNTHETIC'] }));
const catalog = createManualEntryCatalog(yearMonth(2026, 8), definitions), content = createBlankManualEntryContent(catalog);
const draft: StoredManualEntryDraft = { recordKind: 'manual-entry-draft', payloadVersion: 1, scopeId: 'scope', draftId: '11111111-1111-4111-8111-111111111111', reportCycle: catalog.reportCycle, draftRevision: 1, catalog, content, rawInputHash: 'synthetic', createdAt: '2026-10-27T00:00:00.000Z', savedAt: '2026-10-27T00:00:00.000Z', currentReview: null, confirmationId: null };
const key = '22222222-2222-4222-8222-222222222222';
function receiptDeps(action: 'create' | 'save' | 'prepare' | 'confirm', command: Parameters<typeof manualEntryRequestHashInput>[1], acknowledgement: unknown) {
  const forbidden = async (): Promise<never> => { throw Error('CURRENT_STATE_MUST_NOT_BE_READ'); };
  const repository = { getManualEntryCommand: async () => ({ action, requestHash: hash(manualEntryRequestHashInput(action, command)), acknowledgement }), getManualEntry: forbidden, currentHeads: forbidden, createManualEntry: forbidden, saveManualEntry: forbidden, commitManualEntry: forbidden };
  return { repository, hash, ecosCatalog: [], metadataClock: forbidden, clock: forbidden } as unknown as ManualEntryDependencies;
}
describe('manual successful command receipts precede mutable state', () => {
  it('create and save return the acknowledged raw revision without a current lookup', async () => {
    const create = { reportTitleMonth: yearMonth(2026, 8), idempotencyKey: key };
    const created = await createManualEntry(receiptDeps('create', create, draft), 'scope', create);
    expect(created.draftRevision).toBe(1); expect(created.state).toBe('editing'); expect(created).not.toHaveProperty('scopeId');
    const save = { draftId: draft.draftId, expectedDraftRevision: 1, idempotencyKey: key, content };
    expect((await saveManualEntry(receiptDeps('save', save, draft), 'scope', save)).content).toEqual(content);
  });
  it('confirm returns its original kind and revision after newer heads exist', async () => {
    const command = { draftId: draft.draftId, expectedDraftRevision: 1, candidateId: key, documentHash: 'a'.repeat(64), expectedRevision: 0 as const, idempotencyKey: key };
    const ack = { kind: 'confirmed' as const, confirmationId: key, revision: 1 };
    expect(await confirmManualEntry(receiptDeps('confirm', command, ack), 'scope', command)).toEqual(ack);
  });
  it('a key reused for different semantic input is rejected before current state', async () => {
    const command = { draftId: draft.draftId, expectedDraftRevision: 1, idempotencyKey: key };
    const deps = receiptDeps('prepare', command, {});
    await expect(prepareManualEntry(deps, 'scope', { ...command, expectedDraftRevision: 2 })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });
});
