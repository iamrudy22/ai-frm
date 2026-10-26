import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { handleEditorPost, handleDraftsGet, handleDraftsPost, handleReviewsGet, handleReviewsPost } from './report-history-editor-handlers';
import { handleCorrectionPost, handleExchangeGet, handleExchangePost } from './report-history-exchange-handlers';
import { handleConfirmationPost } from './report-history-confirmation-handlers';
import { HistoryOperationError, type CorrectionDependencies, type HistoryRepository } from '@/application/report-history/ports';
import type { CorrectionDraftDto, CorrectionEditorDto, DraftContent } from '@/domain/report-history/correction';
import { SqliteHistoryRepository, hashHistoryValue } from '@/infrastructure/report-history/sqlite-history-repository';
import { SCORING_RULES } from '@/domain/risk/construction-perception/policy';
import { yearMonth } from '@/domain/shared/year-month';
import { calendarDate } from '@/domain/shared/calendar-date';

const root = 'http://localhost:3003/api/report-history';
const id = '11111111-1111-4111-8111-111111111111';
const key = () => randomUUID();
const content: DraftContent = { edits: [{ rowId: 'server:cash:2026/01', action: 'set', rawValue: '-' }], reason: '', evidenceNote: '' };
const post = (path: string, body: unknown, headers?: HeadersInit) => new Request(`${root}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (path: string, query: string, headers?: HeadersInit) => new Request(`${root}/${path}?${query}`, { headers });
const never = vi.fn(async (): Promise<never> => { throw Error('PROVIDER_MUST_NOT_RUN'); });
async function payload(response: Response, status = 200) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return response.json();
}
const dirs: string[] = [], repositories: SqliteHistoryRepository[] = [];
afterEach(() => { never.mockClear(); for (const r of repositories.splice(0)) r.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** Only synthetic statements, source captures and temporary SQLite files. */
async function fixture() {
  const [{ captureConstruction, captureFunding }, { prepareReportCandidate, restoreStatement }, { ledgerOf }, { roundEntryOf }, codec, sources] = await Promise.all([
    import('@/application/report-history/report-history'), import('@/application/report-history/report-candidate'), import('@/domain/cashflow/forecast-ledger'), import('@/domain/cashflow/round-entry'), import('@/infrastructure/report-history/evidence-codec'), import('@/infrastructure/report-history/captured-sources'),
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'w4-http-synthetic-')); dirs.push(dir);
  const at = '2026-10-23T00:00:00.000Z';
  const r = new SqliteHistoryRepository(join(dir, 'history.sqlite'), { now: () => at }); repositories.push(r);
  const scopeId = await r.defaultScopeId();
  const basis = { reportCycle: yearMonth(2026, 9), reportTitleMonth: yearMonth(2026, 8), constructionBaseMonth: yearMonth(2026, 7), fundingJudgedMonth: yearMonth(2026, 9), fundingObservedMonth: yearMonth(2026, 8), gapMonth: yearMonth(2026, 9) };
  const source = Object.fromEntries(SCORING_RULES.filter(rule => rule.key !== '분양회수예측오차').map(rule => [rule.key, { unit: '지수', values: new Map([[yearMonth(2026, 7), 110], [yearMonth(2026, 6), 100], [yearMonth(2025, 7), 100]]), fetchedAt: new Date(at) }])) as never;
  const deps: CorrectionDependencies = {
    repository: r, indicators: { fetchAll: async () => source }, yields: { dailyYields: async () => ({ days: [{ date: calendarDate(2026, 8, 31), publicAaa: { average: 3.674, byAgency: { 나이스피앤아이: 3, 한국자산평가: 3, KIS자산평가: 3 } }, treasury: { average: 2.5, byAgency: { 나이스피앤아이: 3, 한국자산평가: 3, KIS자산평가: 3 } } }], fetchedAt: new Date(at) }) },
    clock: () => new Date(at), metadataClock: () => new Date(at), hash: hashHistoryValue, encode: codec.evidenceToJson, decode: codec.evidenceFromJson,
    calculationVersion: 'risk-policy-2026-09-28@e3a8f9e', captureIndicators: sources.captureEconomicSource, captureYields: sources.captureBondSource, replayIndicators: sources.replayEconomicSource, replayYields: sources.replayBondSource, isUnsafe: sources.containsSourceCredentials,
    nextId: randomUUID, ecosCatalog: SCORING_RULES.filter(rule => rule.key !== '분양회수예측오차').map(rule => ({ key: rule.key, stat: 'SYNTHETIC', items: ['I'] })),
    documentFactory: (input, selection) => { const json = codec.evidenceToJson({ dashboard: input.dashboard, construction: input.constructionOutcome, funding: input.fundingOutcome }); return { schemaVersion: 1, templateVersion: 'report@e3a8f9e', contentHash: hashHistoryValue(json), json, historyCalculationIds: selection.historyCalculationIds }; },
  };
  const statements = [6, 8, 9].map(month => ({ asOf: { year: 2026, month, day: 28 }, monthLabels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`), baseMonthIndex: month - 1, planYearEndIndex: 11, amounts: { 기초시재: Array(12).fill(100), 수입계: Array(12).fill(50), 수입: Array(12).fill(40), 분양회수: Array(12).fill(30), 기타수입: Array(12).fill(10), 지출: Array(12).fill(60) } }));
  const ledger = ledgerOf(statements.map(restoreStatement).map(roundEntryOf));
  const c = await captureConstruction(deps, scopeId, { reportMonth: basis.reportCycle }, ledger), f = await captureFunding(deps, scopeId, { judgedMonth: basis.fundingJudgedMonth });
  if (c.history.captureStatus !== 'saved' || f.history.captureStatus !== 'saved') throw Error('fixture capture');
  const selection = await r.createHistorySelection({ scopeId, basis, calculationVersion: deps.calculationVersion, asOf: at, selectedBackfillBatchId: null });
  const candidate = await prepareReportCandidate(deps, { scopeId, basis, statements, sourceMetadata: { files: ['synthetic-june', 'synthetic-aug', 'synthetic-sept'] }, constructionCalculationId: c.history.calculationId, fundingCalculationId: f.history.calculationId, historySelectionId: selection.historySelectionId, authoredAt: at, inputGeneration: 'fixture' }, deps.documentFactory);
  const confirmed = await r.commitConfirmation(scopeId, { candidateId: candidate.candidateId, expectedRevision: 0, idempotencyKey: key() });
  if (confirmed.kind !== 'confirmed') throw Error('fixture confirmation');
  const confirmationId = confirmed.confirmationId;
  const live = vi.fn(async (): Promise<never> => { throw Error('LIVE_SOURCE_CALLED'); });
  const frozen = { ...deps, indicators: { fetchAll: live }, yields: { dailyYields: live } };
  const provider = async () => ({ scopeId, deps: frozen });
  const counts = () => { const db = new DatabaseSync(r.databasePath); const rows = ['source_capture', 'report_input_snapshot', 'report_candidate', 'monthly_confirmation', 'monthly_head', 'correction_draft', 'workbook_export', 'workbook_import', 'correction_preview', 'correction_resolution', 'correction_work_command']; const result = Object.fromEntries(rows.map(table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n])); db.close(); return result; };
  async function open() { return (await payload(await handleEditorPost(post('editor', { action: 'open', confirmationId }), provider))).editor as CorrectionEditorDto; }
  async function create(rawValue = '-', reason = '') { const editor = await open(); return (await payload(await handleDraftsPost(post('drafts', { action: 'create', basisId: editor.basisId, idempotencyKey: key(), content: { edits: [{ rowId: editor.rows.find(row => row.category === 'cashflow')!.rowId, action: 'set', rawValue }], reason, evidenceNote: '' } }), provider))).draft as CorrectionDraftDto; }
  return { r, scopeId, deps: frozen, provider, live, confirmed, candidate, open, create, counts };
}

describe('browser correction HTTP lifecycle', () => {
  it('open → raw save/resume → invalid/valid preview → explicit confirmation/detail; retries remain idempotent', async () => {
    const f = await fixture(), editor = await f.open();
    expect(editor.basis).toMatchObject({ reportCycle: '2026/09', reportTitleMonth: '2026/08' });
    expect(JSON.stringify(editor)).not.toMatch(/fieldPath|sourceRecordId|sourceIdentity|scopeId/);
    const empty = await payload(await handleDraftsPost(post('drafts', { action: 'create', basisId: editor.basisId, idempotencyKey: key(), content: { edits: [], reason: '', evidenceNote: '' } }), f.provider));
    expect(empty).toEqual({ ok: true, result: { kind: 'empty' } });
    const d = await f.create(), before = f.counts();
    const resumed = await payload(await handleDraftsGet(get('drafts', `draftId=${d.draftId}`), f.provider)); expect(resumed.draft).toEqual(d);
    const invalid = await payload(await handleEditorPost(post('editor', { action: 'preview', draftId: d.draftId, expectedDraftRevision: 1 }), f.provider), 422);
    expect(invalid).toMatchObject({ ok: false, code: 'INVALID_CORRECTION', errors: expect.arrayContaining([expect.objectContaining({ field: 'reason' })]) }); expect(f.counts()).toEqual(before);
    const save = { action: 'save', draftId: d.draftId, expectedDraftRevision: 1, idempotencyKey: key(), content: { ...d.content, reason: '합성 정정', edits: [{ ...d.content.edits[0], rawValue: '0' }] } };
    const saved = (await payload(await handleDraftsPost(post('drafts', save), f.provider))).draft as CorrectionDraftDto;
    expect(saved.draftRevision).toBe(2); expect((await payload(await handleDraftsPost(post('drafts', save), f.provider))).draft).toEqual(saved);
    await payload(await handleDraftsPost(post('drafts', { ...save, idempotencyKey: key() }), f.provider), 409);
    await payload(await handleDraftsPost(post('drafts', { ...save, content: d.content }), f.provider), 409);
    const review = (await payload(await handleEditorPost(post('editor', { action: 'preview', draftId: d.draftId, expectedDraftRevision: 2 }), f.provider))).result;
    expect(review).toMatchObject({ kind: 'preview', draftRevision: 2 }); expect(f.counts().monthly_confirmation).toBe(1);
    const preview = await f.r.getCorrectionPreview(f.scopeId, review.previewId);
    const bypass = await payload(await handleConfirmationPost(post('confirmations', { action: 'confirm', candidateId: preview!.candidateId, expectedRevision: 1, idempotencyKey: key(), correctionReason: '합성 정정' }), f.provider), 422); expect(bypass).toMatchObject({ ok: false, result: { kind: 'not-ready', reason: 'CORRECTION_PREVIEW_REQUIRED' } });
    const cmd = { previewId: review.previewId, previewHash: review.previewHash, expectedBaseRevision: 1, idempotencyKey: key(), reason: saved.content.reason };
    const confirmed = await payload(await handleCorrectionPost(post('corrections', cmd), f.provider)); expect(confirmed).toMatchObject({ ok: true, result: { kind: 'confirmed', revision: 2 } });
    expect(await payload(await handleCorrectionPost(post('corrections', cmd), f.provider))).toMatchObject({ ok: true, result: { kind: 'already-confirmed', revision: 2 } });
    const stored = f.counts();
    const detail = await payload(await handleReviewsGet(get('reviews', `refKind=draft&refId=${d.draftId}`), f.provider)); expect(detail.detail).toMatchObject({ summary: { state: 'confirmed' }, rows: [{ originalText: '100', proposedText: '0' }] });
    const list = await payload(await handleReviewsGet(get('reviews', 'pendingOnly=false&limit=20'), f.provider)); expect(list.items).toHaveLength(1);
    const months = await payload(await handleReviewsGet(get('reviews', 'view=months&pendingOnly=false&limit=12'), f.provider)); expect(months.items[0]).toMatchObject({ reportTitleMonth: '2026/08', latestRevision: 2 }); expect(f.counts()).toEqual(stored); expect(f.live).not.toHaveBeenCalled();
  });
  it('close → copy → readonly comparison → explicit reapply preserves the original and requires current head', async () => {
    const f = await fixture(), d = await f.create('25', '합성 정정'), ref = { kind: 'draft', id: d.draftId };
    expect(await payload(await handleReviewsPost(post('reviews', { action: 'close', ref, expectedDraftRevision: 1, idempotencyKey: key() }), f.provider))).toMatchObject({ result: { state: 'closed' } });
    await payload(await handleDraftsPost(post('drafts', { action: 'save', draftId: d.draftId, expectedDraftRevision: 1, idempotencyKey: key(), content: d.content }), f.provider), 409);
    const copy = (await payload(await handleReviewsPost(post('reviews', { action: 'copy', ref, idempotencyKey: key() }), f.provider))).result as CorrectionDraftDto;
    expect(copy).toMatchObject({ requiresReapply: true, content: { edits: [] } }); expect(copy.draftId).not.toBe(d.draftId);
    const before = f.counts(), detail = await payload(await handleReviewsGet(get('reviews', `refKind=draft&refId=${copy.draftId}`), f.provider)); expect(detail.detail.rows[0]).toMatchObject({ originalText: '100', proposedText: '25', current: { originalText: '100' } }); expect(f.counts()).toEqual(before);
    await payload(await handleEditorPost(post('editor', { action: 'preview', draftId: copy.draftId, expectedDraftRevision: 1 }), f.provider), 422);
    await payload(await handleReviewsPost(post('reviews', { action: 'reapply', draftId: copy.draftId, expectedDraftRevision: 1, expectedLatestConfirmationId: id, idempotencyKey: key() }), f.provider), 409);
    const reapplied = (await payload(await handleReviewsPost(post('reviews', { action: 'reapply', draftId: copy.draftId, expectedDraftRevision: 1, expectedLatestConfirmationId: f.confirmed.confirmationId, idempotencyKey: key() }), f.provider))).result;
    expect(reapplied).toMatchObject({ requiresReapply: false, draftRevision: 2, content: d.content }); expect(f.counts().monthly_confirmation).toBe(1);
    expect((await payload(await handleReviewsGet(get('reviews', `refKind=draft&refId=${d.draftId}`), f.provider))).detail.summary.state).toBe('closed'); expect(f.live).not.toHaveBeenCalled();
  });
  it('missing and foreign-scope IDs are indistinguishable; forged rows and duplicate rows are rejected', async () => {
    const f = await fixture(), d = await f.create(), editor = d.editor;
    for (const p of [f.provider, async () => ({ scopeId: 'other-scope', deps: f.deps })]) {
      await payload(await handleDraftsGet(get('drafts', `draftId=${p === f.provider ? id : d.draftId}`), p), 404);
      await payload(await handleReviewsGet(get('reviews', `refKind=draft&refId=${p === f.provider ? id : d.draftId}`), p), 404);
    }
    for (const edits of [[{ rowId: 'forged', action: 'set', rawValue: '5' }], [d.content.edits[0], d.content.edits[0]], [{ ...d.content.edits[0], action: 'set-missing', rawValue: null }]]) {
      await payload(await handleDraftsPost(post('drafts', { action: 'create', basisId: editor.basisId, idempotencyKey: key(), content: { ...d.content, edits } }), f.provider), 422);
    }
    expect(f.counts().correction_draft).toBe(1);
  });
  it('storage rollback and a lost response both allow exact-key retry without duplicate state or false ACK', async () => {
    const f = await fixture(), d = await f.create(), before = f.counts();
    const cmd = { action: 'save', draftId: d.draftId, expectedDraftRevision: 1, idempotencyKey: key(), content: { ...d.content, reason: '합성 보관', edits: [{ ...d.content.edits[0], rawValue: '-.' }] } };
    const db = new DatabaseSync(f.r.databasePath);
    try {
      db.exec("CREATE TRIGGER synthetic_write_failure BEFORE INSERT ON correction_work_command BEGIN SELECT RAISE(ABORT,'/private/synthetic/disk'); END;");
      const failed = await handleDraftsPost(post('drafts', cmd), f.provider);
      expect(await payload(failed, 503)).toEqual({ ok: false, code: 'STORAGE_UNAVAILABLE' }); expect(failed.headers.get('retry-after')).toBe('1'); expect(f.counts()).toEqual(before);
      db.exec('DROP TRIGGER synthetic_write_failure');
      // Deliberately discard the successful response, as if transport failed after commit.
      await handleDraftsPost(post('drafts', cmd), f.provider);
      const after = f.counts(), retried = await payload(await handleDraftsPost(post('drafts', cmd), f.provider));
      expect(retried).toMatchObject({ ok: true, draft: { draftId: d.draftId, draftRevision: 2, content: cmd.content } }); expect(f.counts()).toEqual(after);
      const invalid = await payload(await handleEditorPost(post('editor', { action: 'preview', draftId: d.draftId, expectedDraftRevision: 2 }), f.provider), 422); expect(invalid.errors).toContainEqual(expect.objectContaining({ field: 'value', code: 'INVALID_NUMBER' }));
    } finally { db.close(); }
  });
  it('legacy XLSX previews remain readable through reviews and confirm through the original five-field correction command', async () => {
    const f = await fixture();
    const [correction, { historyWorkbookCodec }, X] = await Promise.all([import('@/application/report-history/report-correction'), import('@/infrastructure/report-history/history-workbook'), import('xlsx')]);
    const legacyDeps = { ...f.deps, workbookCodec: historyWorkbookCodec };
    const manifest = await correction.exportCorrectionWorkbook(legacyDeps, f.scopeId, f.confirmed.confirmationId);
    const book = X.read(historyWorkbookCodec.encode(manifest), { type: 'array' }), sheet = book.Sheets['자금자료_정정'];
    sheet.G2 = { t: 's', v: '값수정' }; sheet.H2 = { t: 'n', v: 0 }; sheet.I2 = { t: 's', v: '합성 정정' };
    const review = await correction.validateCorrectionWorkbook(legacyDeps, f.scopeId, new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx', compression: true })));
    if (review.kind !== 'preview') throw Error('fixture legacy preview');
    const before = f.counts(), detail = await payload(await handleReviewsGet(get('reviews', `refKind=legacy-preview&refId=${review.previewId}`), f.provider));
    expect(detail).toMatchObject({ ok: true, detail: { summary: { ref: { kind: 'legacy-preview', id: review.previewId }, state: 'pending' }, rows: [{ originalText: '100', proposedText: '0' }] } });
    expect(JSON.stringify(detail)).not.toMatch(/fieldPath|sourceRecordId|sourceIdentity|fileHash|workbookBytes/); expect(f.counts()).toEqual(before);
    const cmd = { previewId: review.previewId, previewHash: review.previewHash, expectedBaseRevision: 1, idempotencyKey: key(), reason: '합성 정정' };
    expect(await payload(await handleCorrectionPost(post('corrections', cmd), f.provider))).toMatchObject({ ok: true, result: { kind: 'confirmed', revision: 2 } }); expect(f.live).not.toHaveBeenCalled();
  });
  it('closing a legacy preview blocks a new confirm but preserves read-only detail and original wire', async () => {
    const f = await fixture();
    const [correction, { historyWorkbookCodec }, X] = await Promise.all([import('@/application/report-history/report-correction'), import('@/infrastructure/report-history/history-workbook'), import('xlsx')]);
    const legacyDeps = { ...f.deps, workbookCodec: historyWorkbookCodec }, manifest = await correction.exportCorrectionWorkbook(legacyDeps, f.scopeId, f.confirmed.confirmationId);
    const book = X.read(historyWorkbookCodec.encode(manifest), { type: 'array' }), sheet = book.Sheets['자금자료_정정'];
    sheet.G2 = { t: 's', v: '값수정' }; sheet.H2 = { t: 'n', v: 0 }; sheet.I2 = { t: 's', v: '합성 정정' };
    const review = await correction.validateCorrectionWorkbook(legacyDeps, f.scopeId, new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx', compression: true })));
    if (review.kind !== 'preview') throw Error('fixture legacy preview');
    const ref = { kind: 'legacy-preview', id: review.previewId };
    await payload(await handleReviewsPost(post('reviews', { action: 'close', ref, expectedDraftRevision: null, idempotencyKey: key() }), f.provider));
    const response = await handleCorrectionPost(post('corrections', { previewId: review.previewId, previewHash: review.previewHash, expectedBaseRevision: 1, idempotencyKey: key(), reason: '합성 정정' }), f.provider);
    expect(await payload(response, 409)).toMatchObject({ ok: false, result: { kind: 'conflict', reason: 'WORK_CLOSED' } });
    expect((await payload(await handleReviewsGet(get('reviews', `refKind=legacy-preview&refId=${review.previewId}`), f.provider))).detail.summary.state).toBe('closed'); expect(f.counts().monthly_confirmation).toBe(1);
  });
});

describe('strict transport boundaries', () => {
  const handlers = [handleEditorPost, handleDraftsPost, handleReviewsPost];
  it('all GET/POST guards run before reading a body or constructing a provider', async () => {
    for (const handler of [...handlers, handleDraftsGet, handleReviewsGet, handleExchangeGet, handleExchangePost, handleCorrectionPost]) {
      for (const headers of [{ origin: 'https://foreign.test' }, { host: 'foreign.test:3003' }, { host: '127.0.0.1:3003', origin: 'http://localhost:3003' }, { origin: 'http://localhost:3004' }] as HeadersInit[]) {
        const request = post('editor', {}, headers); const reader = vi.spyOn(request.body!, 'getReader'); await payload(await handler(request, never), 403); expect(reader).not.toHaveBeenCalled();
      }
    }
    expect(never).not.toHaveBeenCalled();
  });
  it.each([
    ['editor', handleEditorPost, { action: 'open', confirmationId: id, scopeId: 'forged' }],
    ['editor', handleEditorPost, { action: 'preview', draftId: id, expectedDraftRevision: '1' }],
    ['editor', handleEditorPost, { action: 'preview', draftId: id, expectedDraftRevision: 0 }],
    ['drafts', handleDraftsPost, { action: 'create', basisId: id, idempotencyKey: id, content: { ...content, result: 5 } }],
    ['drafts', handleDraftsPost, { action: 'save', draftId: id, expectedDraftRevision: 1, idempotencyKey: id, content: { ...content, edits: [{ ...content.edits[0], fieldPath: 'bad' }] } }],
    ['drafts', handleDraftsPost, { action: 'create', basisId: id, idempotencyKey: id, content: { ...content, edits: [{ ...content.edits[0], rawValue: 1 }] } }],
    ['drafts', handleDraftsPost, { action: 'create', basisId: id, idempotencyKey: id, content: { ...content, edits: [{ ...content.edits[0], action: 'set-missing', rawValue: '0' }] } }],
    ['reviews', handleReviewsPost, { action: 'close', ref: { kind: 'draft', id, scopeId: 'bad' }, expectedDraftRevision: 1, idempotencyKey: id }],
    ['reviews', handleReviewsPost, { action: 'close', ref: { kind: 'legacy-preview', id }, expectedDraftRevision: 1, idempotencyKey: id }],
    ['reviews', handleReviewsPost, { action: 'copy', ref: { kind: 'draft', id }, idempotencyKey: id, unknown: true }],
    ['reviews', handleReviewsPost, { action: 'reapply', draftId: id, expectedDraftRevision: Number.MAX_SAFE_INTEGER + 1, expectedLatestConfirmationId: id, idempotencyKey: id }],
  ])('%s rejects unknown/nested fields or malformed action DTO before provider', async (path, handler, body) => { await payload(await handler(post(path, body), never), 422); expect(never).not.toHaveBeenCalled(); });
  it.each(['draftId=x&draftId=y', `draftId=${id}&scopeId=forged`, ''])('draft query rejects duplicate/unknown/missing fields: %s', async query => { await payload(await handleDraftsGet(get('drafts', query), never), 422); expect(never).not.toHaveBeenCalled(); });
  it.each([`refKind=draft&refId=${id}&limit=20`, `refKind=draft&refId=${id}&refId=${id}`, 'pendingOnly=true&limit=21', 'pendingOnly=1&limit=20', 'pendingOnly=false&limit=20&view=months', 'view=months&pendingOnly=false&limit=12&reportCycle=2026%2F09', 'pendingOnly=false&limit=20&reportCycle=2026%2F13', 'pendingOnly=false&limit=20&unknown=1', 'view=months&pendingOnly=false&limit=12&fromCycle=2026%2F10&toCycle=2026%2F09'])('reviews rejects mixed/duplicate/unknown/invalid query: %s', async query => { await payload(await handleReviewsGet(get('reviews', query), never), 422); expect(never).not.toHaveBeenCalled(); });
  it('limits every string and edit count before provider; raw incomplete strings remain allowed', async () => {
    for (const value of [{ ...content, reason: 'x'.repeat(2001) }, { ...content, evidenceNote: 'x'.repeat(2001) }, { ...content, edits: [{ ...content.edits[0], rowId: 'x'.repeat(2001) }] }, { ...content, edits: [{ ...content.edits[0], rawValue: 'x'.repeat(2001) }] }, { ...content, edits: Array(10001).fill(content.edits[0]) }]) {
      await payload(await handleDraftsPost(post('drafts', { action: 'create', basisId: id, idempotencyKey: id, content: value }), never), 413);
    }
    expect(never).not.toHaveBeenCalled();
  });
  it('accepts exact row/text bounds and forwards raw values unchanged without a file codec', async () => {
    const create = vi.fn(async () => null);
    const ready = async () => ({ scopeId: 'server-scope', deps: { repository: { createCorrectionDraft: create } } as unknown as CorrectionDependencies });
    const bounded = { reason: ' '.repeat(2000), evidenceNote: '근'.repeat(2000), edits: [{ rowId: 'x'.repeat(2000), action: 'set', rawValue: '-'.repeat(2000) }] };
    const body = { action: 'create', basisId: id, idempotencyKey: id, content: bounded };
    // Maximum textual bounds can exceed the byte bound together; check each independent boundary.
    for (const checked of [{ ...bounded, edits: [bounded.edits[0]] }, { ...content, edits: Array.from({ length: 10000 }, (_, index) => ({ rowId: `row:${index}`, action: 'set', rawValue: '-' })) }]) {
      expect(await payload(await handleDraftsPost(post('drafts', { ...body, content: checked }), ready))).toEqual({ ok: true, result: { kind: 'empty' } });
      expect(create).toHaveBeenLastCalledWith('server-scope', { basisId: id, idempotencyKey: id, content: checked });
    }
  });
  it('correction result conflicts/not-ready retain the five-field envelope and unknown result messages are hidden', async () => {
    const command = { previewId: id, previewHash: 'a'.repeat(64), expectedBaseRevision: 1, idempotencyKey: id, reason: '합성 정정' };
    for (const result of [{ kind: 'conflict', reason: 'STALE_DRAFT' }, { kind: 'not-ready', reason: 'INVALID_CORRECTION_COMMAND' }]) {
      const ready = async () => ({ scopeId: 'server-scope', deps: { repository: { commitCorrection: async () => result } } as unknown as CorrectionDependencies });
      expect(await payload(await handleCorrectionPost(post('corrections', command), ready), result.kind === 'conflict' ? 409 : 422)).toEqual({ ok: false, result });
    }
    const unknown = async () => ({ scopeId: 'server-scope', deps: { repository: { commitCorrection: async () => ({ kind: 'not-ready', reason: '/private/internal/db unknown failure' }) } } as unknown as CorrectionDependencies });
    const response = await handleCorrectionPost(post('corrections', command), unknown);
    expect(await payload(response, 503)).toEqual({ ok: false, code: 'STORAGE_UNAVAILABLE' }); expect(response.headers.get('retry-after')).toBe('1');
  });
  it('streamed_editor_body_is_bounded_without_content_length', async () => {
    for (const handler of handlers) for (const length of [undefined, '1']) {
      let cancelled = false;
      const request = new Request(`${root}/editor`, { method: 'POST', headers: { 'content-type': 'application/json', ...(length ? { 'content-length': length } : {}) }, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(3 * 1024 * 1024)); c.enqueue(new Uint8Array(3 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; throw Error('CANCEL_FAILURE_INTERNAL_PATH'); } }), duplex: 'half' } as RequestInit);
      expect(await payload(await handler(request, never), 413)).toEqual({ ok: false, code: 'BODY_TOO_LARGE' }); expect(cancelled).toBe(true);
    }
    // A valid JSON object padded with whitespace reaches the exact binary MiB boundary.
    const raw = JSON.stringify({ action: 'preview', draftId: id, expectedDraftRevision: 1 });
    const request = new Request(`${root}/editor`, { method: 'POST', body: raw + ' '.repeat(6 * 1024 * 1024 - raw.length) });
    const response = await handleEditorPost(request, async () => { throw new HistoryOperationError('NOT_FOUND'); }); expect(response.status).toBe(404);
    expect(never).not.toHaveBeenCalled();
  });
  it('malformed JSON, non-objects and invalid UTF-8 are input errors', async () => {
    for (const body of ['{', '[]', 'null', new Uint8Array([0xff])]) await payload(await handleEditorPost(new Request(`${root}/editor`, { method: 'POST', body }), never), 422);
    expect(never).not.toHaveBeenCalled();
  });
  it.each([['NOT_FOUND', 404], ['UNSUPPORTED_VERSION', 422], ['EVALUATION_ZONE_MISMATCH', 422], ['INVALID_DRAFT', 422], ['STALE_BASE', 409], ['STALE_DEPENDENCY', 409], ['STALE_DRAFT', 409], ['WORK_CLOSED', 409], ['IDEMPOTENCY_KEY_REUSED', 409], ['LIMIT_EXCEEDED', 413], ['STORAGE_UNAVAILABLE', 503]] as const)('maps known service %s errors to %s with no-store', async (code, status) => {
    const response = await handleEditorPost(post('editor', { action: 'open', confirmationId: id }), async () => { throw new HistoryOperationError(code); });
    expect(await payload(response, status)).toEqual({ ok: false, code }); if (status === 503) expect(response.headers.get('retry-after')).toBe('1');
  });
  it('unknown errors and provider/storage failures never expose internal paths or messages', async () => {
    const failing = async (): Promise<never> => { throw Error('/private/synthetic/db SQLITE secret'); };
    for (const handler of handlers) {
      const value = handler === handleEditorPost ? { action: 'open', confirmationId: id } : handler === handleDraftsPost ? { action: 'create', basisId: id, idempotencyKey: id, content } : { action: 'copy', ref: { kind: 'draft', id }, idempotencyKey: id };
      const response = await handler(post('editor', value), failing); expect(await payload(response, 503)).toEqual({ ok: false, code: 'STORAGE_UNAVAILABLE' }); expect(response.headers.get('retry-after')).toBe('1');
    }
  });
  it('GET draft/detail/list/months call only readonly service ports with server scope and opaque cursors', async () => {
    const read = vi.fn(async () => ({ items: [], nextCursor: 'opaque-next' }));
    const repository = { listCorrectionWork: read, listCorrectionMonths: read, getCorrectionReviewDetail: async () => ({ summary: { state: 'closed' }, rows: [] }) } as unknown as HistoryRepository;
    const deps = new Proxy({ repository } as CorrectionDependencies, { get(target, name) { if (name !== 'repository') throw Error('MUTATION_DEPENDENCY'); return target.repository; } });
    const ready = async () => ({ scopeId: 'server-scope', deps });
    expect(await payload(await handleReviewsGet(get('reviews', 'pendingOnly=true&limit=20&cursor=opaque%2Btoken'), ready))).toEqual({ ok: true, items: [], nextCursor: 'opaque-next' });
    expect(read).toHaveBeenLastCalledWith('server-scope', { pendingOnly: true, limit: 20, cursor: 'opaque+token' });
    await payload(await handleReviewsGet(get('reviews', 'view=months&pendingOnly=false&limit=12&fromCycle=2026%2F01&toCycle=2026%2F12'), ready));
    expect(read).toHaveBeenLastCalledWith('server-scope', { pendingOnly: false, limit: 12, fromCycle: '2026/01', toCycle: '2026/12' });
    await payload(await handleReviewsGet(get('reviews', `refKind=legacy-preview&refId=${id}`), ready));
  });
  it('exchange_is_retired_and_web_basis_is_never_encoded', async () => {
    for (const request of [post('exchange', { action: 'export', confirmationId: id }), new Request(`${root}/exchange`, { method: 'POST', body: 'malformed body', headers: { 'content-length': '999999999' } })]) {
      expect(await payload(await handleExchangePost(request, never), 410)).toEqual({ ok: false, code: 'EXCHANGE_RETIRED' }); expect(request.bodyUsed).toBe(false);
    }
    for (const query of [`exportId=${id}`, `previewId=${id}`, 'unknown=1']) expect(await payload(await handleExchangeGet(get('exchange', query), never), 410)).toEqual({ ok: false, code: 'EXCHANGE_RETIRED' });
    expect(never).not.toHaveBeenCalled();
  });
});
