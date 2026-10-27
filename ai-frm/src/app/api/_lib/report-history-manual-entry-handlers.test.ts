import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SqliteHistoryRepository, hashHistoryValue, HISTORY_CALCULATION_VERSION } from '@/infrastructure/report-history/sqlite-history-repository';
import { evidenceToJson, evidenceFromJson } from '@/infrastructure/report-history/evidence-codec';
import { captureEconomicSource, captureBondSource, replayEconomicSource, replayBondSource } from '@/infrastructure/report-history/captured-sources';
import { ECOS_SERIES } from '@/infrastructure/ecos/ecos-indicator-source';
import { normalizeManualEntry, type ManualEntryContentV1, type ManualEntryDraftDto } from '@/domain/report-history/manual-entry';
import { assessPerception } from '@/application/construction-perception';
import { assessFundingRiskReport } from '@/application/funding-risk';
import { assessDashboard } from '@/application/dashboard';
import { ledgerOf } from '@/domain/cashflow/forecast-ledger';
import { roundEntryOf } from '@/domain/cashflow/round-entry';
import { restoreStatement, prepareReportCandidate, confirmMonthlyReport } from '@/application/report-history/report-candidate';
import { prepareCorrectionEditor, previewCorrectionDraft, confirmCorrection } from '@/application/report-history/report-correction';
import { createCorrectionDraft } from '@/application/report-history/correction-work';
import { reportDocumentFactory } from './report-history-confirmation-handlers';
import type { SourceResult } from '@/application/ports';
import type { CorrectionDependencies } from '@/application/report-history/ports';
import type { FinancialReport } from '@/app/aifrm/report-model';
import { arrangeRounds } from '@/app/aifrm/uploaded-rounds';
import { buildFinancialReport } from '@/app/aifrm/report-model';
import { withExternalRiskHistory } from '@/app/aifrm/report-history-projection';
import { selectionView } from './report-history-selection-handlers';

const roots: string[] = [], repositories: SqliteHistoryRepository[] = [];
afterEach(() => { vi.restoreAllMocks(); repositories.splice(0).forEach(r => r.close()); roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); });
const savedAt = '2026-10-27T00:00:00.000Z', preparedAt = '2026-10-27T00:05:00.000Z';
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
async function fixture(clock = () => new Date(preparedAt)) {
  const root = mkdtempSync(join(tmpdir(), 'aifrm-manual-service-')); roots.push(root);
  const repository = new SqliteHistoryRepository(join(root, 'history.sqlite'), { now: () => savedAt }); repositories.push(repository);
  const scopeId = await repository.defaultScopeId();
  const forbidden = vi.fn(async (): Promise<never> => { throw Error('REMOTE_OR_CODEC_FORBIDDEN'); });
  const base = { repository, clock, metadataClock: vi.fn(() => new Date(savedAt)), hash: hashHistoryValue, encode: evidenceToJson, decode: evidenceFromJson,
    indicators: { fetchAll: forbidden }, yields: { dailyYields: forbidden }, captureIndicators: captureEconomicSource, captureYields: captureBondSource,
    replayIndicators: replayEconomicSource, replayYields: replayBondSource, isUnsafe: () => false, calculationVersion: HISTORY_CALCULATION_VERSION,
    nextId: randomUUID, ecosCatalog: ECOS_SERIES.map(d => ({ key: d.key, name: d.key, statistic: d.stat, items: d.items })) };
  const deps = { ...base, documentFactory: reportDocumentFactory(base, scopeId) };
  const handlers = await import('./report-history-manual-entry-handlers').catch(() => null);
  expect(handlers?.handleManualEntryPost, 'manual entry HTTP service must exist').toBeTypeOf('function');
  const provider = async () => ({ scopeId, deps });
  const post = (body: unknown, query = '', headers: HeadersInit = {}) => handlers!.handleManualEntryPost(new Request(`http://localhost/api/report-history/manual-entries${query}`, { method: 'POST', headers, body: JSON.stringify(body) }), provider);
  const get = (query: string, headers: HeadersInit = {}) => handlers!.handleManualEntryGet(new Request(`http://localhost/api/report-history/manual-entries${query}`, { headers }), provider);
  return { repository, deps, scopeId, forbidden, post, get, handlers: handlers!, provider };
}
async function created(f: Awaited<ReturnType<typeof fixture>>, title = '2026/08') {
  f.deps.metadataClock.mockReturnValue(new Date(savedAt));
  const command = { action: 'create', reportTitleMonth: title, idempotencyKey: randomUUID() };
  const response = await f.post(command); expect(response.status).toBe(200);
  const body = await response.json(); return { draft: body.draft as ManualEntryDraftDto, command, body };
}
function ready(draft: ManualEntryDraftDto): Mutable<ManualEntryContentV1> {
  const content = structuredClone(draft.content) as Mutable<ManualEntryContentV1>;
  for (const c of draft.catalog.cashflow) {
    const round = content.cashflow[c.round]; round.enabled = true; round.asOfRaw = `${c.round.replace('/', '-')}-23`;
    for (const [item, row] of Object.entries(round.items)) for (const month of c.months) row.values[month] = item === '기초시재' ? '100' : item === '수입계' ? '9999' : item === '지출' ? '30' : '10';
  }
  for (const c of draft.catalog.economic) { content.economic[c.key].unitRaw = 'SYNTHETIC 공표 단위'; content.economic[c.key].values[c.currentMonth] = '120'; content.economic[c.key].values[c.referenceMonth] = '100'; }
  const agency = { 나이스피앤아이: '1', 한국자산평가: '9', KIS자산평가: '' };
  content.funding.days = [{ rowId: randomUUID(), dateRaw: `${draft.catalog.funding.observedMonth.replace('/', '-')}-28`, publicAaa: { averageRaw: '3.123', byAgencyRaw: agency }, treasury: { averageRaw: '2.001', byAgencyRaw: { ...agency } } }];
  content.note = 'SYNTHETIC'; return content;
}
async function saved(f: Awaited<ReturnType<typeof fixture>>, title?: string) {
  const c = await created(f, title), content = ready(c.draft);
  const command = { action: 'save', draftId: c.draft.draftId, expectedDraftRevision: c.draft.draftRevision, idempotencyKey: randomUUID(), content };
  const response = await f.post(command); expect(response.status).toBe(200);
  const body = await response.json(); return { ...c, content, draft: body.draft as ManualEntryDraftDto, saveCommand: command, saveBody: body };
}
async function prepared(f: Awaited<ReturnType<typeof fixture>>, title?: string) {
  const s = await saved(f, title), command = { action: 'prepare', draftId: s.draft.draftId, expectedDraftRevision: s.draft.draftRevision, idempotencyKey: randomUUID() };
  f.deps.metadataClock.mockReturnValue(new Date(preparedAt));
  const response = await f.post(command); expect(response.status).toBe(200);
  const body = await response.json(); return { ...s, prepareCommand: command, result: body.result, prepareBody: body };
}
function counts(repository: SqliteHistoryRepository) {
  const db = new DatabaseSync(repository.databasePath, { readOnly: true });
  try { return ['source_capture', 'report_input_snapshot', 'calculation_record', 'history_selection', 'report_document', 'report_candidate', 'monthly_head'].map(t => Number(db.prepare(`SELECT count(*) AS n FROM ${t}`).get()?.n)); } finally { db.close(); }
}

describe('manual entry services and strict API', () => {
  it('creates/resumes raw drafts, separates immutable ACK from current GET and validates before prepare', async () => {
    const f = await fixture(), c = await created(f);
    expect(c.draft).toMatchObject({ reportCycle: '2026/09', draftRevision: 1, state: 'editing' }); expect(c.draft).not.toHaveProperty('scopeId');
    expect((await (await f.post({ ...c.command, idempotencyKey: randomUUID() })).json()).draft.draftId).toBe(c.draft.draftId);
    const invalid = await f.post({ action: 'prepare', draftId: c.draft.draftId, expectedDraftRevision: 1, idempotencyKey: randomUUID() });
    expect(invalid.status).toBe(422); expect(await invalid.json()).toMatchObject({ code: 'INVALID_MANUAL_ENTRY', errors: expect.arrayContaining([expect.objectContaining({ field: expect.any(String) })]) }); expect(counts(f.repository)).toEqual([0,0,0,0,0,0,0]);
    const content = ready(c.draft), save = { action: 'save', draftId: c.draft.draftId, expectedDraftRevision: 1, idempotencyKey: randomUUID(), content };
    const first = await (await f.post(save)).json();
    expect(await (await f.post(c.command)).json()).toEqual(c.body);
    await f.post({ ...save, expectedDraftRevision: 2, idempotencyKey: randomUUID(), content: { ...content, note: 'new' } });
    expect(await (await f.post(save)).json()).toEqual(first);
    expect((await (await f.get(`?draftId=${c.draft.draftId}`)).json()).draft).toMatchObject({ draftRevision: 3, content: { note: 'new' } });
    expect((await (await f.get('?limit=12')).json()).items).toHaveLength(1);
  });
  it('uses original assessors exactly, preserves units/published averages and freezes actual clock calls', async () => {
    let clockCalls = 0; const f = await fixture(() => new Date(Date.parse(preparedAt) + clockCalls++ * 60000)), p = await prepared(f);
    const candidate = (await f.repository.getCandidate(f.scopeId, p.result.review.candidateId))!, input = (await f.repository.getInputSnapshot(f.scopeId, candidate.inputSnapshotId))!;
    const normalized = normalizeManualEntry(p.draft.catalog, p.content); if (normalized.kind !== 'ready') throw Error('synthetic normalize');
    const statements = normalized.statements.map(restoreStatement), ledger = ledgerOf(statements.map(roundEntryOf));
    const source = Object.fromEntries(p.draft.catalog.economic.map(c => { const n = normalized.economic.find(s => s.key === c.key); return [c.key, { values: new Map(n?.values.map(v => [v.month, v.value]) ?? []), unit: n?.unit ?? '' }]; })) as unknown as SourceResult;
    const expectedC = await assessPerception({ fetchAll: async () => source }, ledger, { reportMonth: p.draft.reportCycle }, () => new Date(preparedAt));
    const expectedF = await assessFundingRiskReport({ dailyYields: async () => ({ days: normalized.yields, fetchedAt: new Date(p.draft.savedAt) }) }, { judgedMonth: p.draft.reportCycle }, () => new Date(preparedAt));
    const construction = (await f.repository.getCalculation(f.scopeId, candidate.calculationIds.construction))!, funding = (await f.repository.getCalculation(f.scopeId, candidate.calculationIds.funding))!;
    expect(evidenceFromJson(construction.resultJson)).toEqual(expectedC); expect(evidenceFromJson(funding.resultJson)).toEqual(expectedF);
    expect(construction.evaluationClockTrace).toEqual([preparedAt, preparedAt]); expect(funding.evaluationClockTrace).toEqual([preparedAt]); expect(clockCalls).toBe(1);
    expect(input.createdAt).toBe(preparedAt); expect(input.derivation).toMatchObject({ recordedAt: savedAt }); expect(evidenceFromJson(input.sourceMetadata)).toMatchObject({ kind: 'manual-input', recordedAt: savedAt });
    expect(input.statements).toEqual(normalized.statements); expect(counts(f.repository)).toEqual([2,1,2,1,1,1,0]); expect(f.forbidden).not.toHaveBeenCalled();
    const selection = (await f.repository.getHistorySelection(f.scopeId, candidate.historySelectionId))!;
    const arranged = arrangeRounds(statements.map((statement, i) => ({ statement, file: `synthetic-${i}` }))); if (!arranged.ok) throw Error('synthetic rounds');
    const raw = buildFinancialReport({ rounds: arranged.rounds, dashboard: assessDashboard(statements[1], statements[2], statements[2].defaultBaseMonth), gapMonth: p.draft.reportCycle, perception: JSON.parse(JSON.stringify(expectedC)), funding: JSON.parse(JSON.stringify(expectedF)), generatedAt: new Date(preparedAt) });
    const original = withExternalRiskHistory(raw, selectionView(selection, evidenceFromJson), { construction: candidate.basis.constructionBaseMonth, funding: candidate.basis.fundingObservedMonth, scopeId: f.scopeId });
    const report = candidate.document.json as FinancialReport;
    const numbers = (value: FinancialReport) => value.metrics.map(({ source, narrative, historyNote, ...numeric }) => { void source; void narrative; void historyNote; return numeric; });
    expect(numbers(report)).toEqual(JSON.parse(JSON.stringify(numbers(original))));
    const provenanceFree = (value: unknown) => JSON.parse(JSON.stringify(value, (key, field) => key === 'file' || key === 'sourceFile' ? 'source-label' : field));
    expect(provenanceFree(report.referenceTrends)).toEqual(provenanceFree(original.referenceTrends)); expect(report.metrics.every(m => m.source.includes('직접 입력'))).toBe(true);
    const repeated = await f.post({ ...p.prepareCommand, idempotencyKey: randomUUID() }); expect((await repeated.json()).result.review).toEqual(p.result.review); expect(counts(f.repository)).toEqual([2,1,2,1,1,1,0]);
  });
  it('keeps two raw source envelopes with month guard sourceState not-requested and empty values', async () => {
    const f = await fixture(() => new Date('2026-08-10T00:00:00.000Z')), p = await saved(f), content = structuredClone(p.content);
    for (const s of Object.values(content.economic)) for (const month of Object.keys(s.values)) Object.assign(s.values, { [month]: '' });
    content.funding.days = []; content.funding.noDataReason = 'SYNTHETIC empty';
    const s = await (await f.post({ ...p.saveCommand, expectedDraftRevision: 2, idempotencyKey: randomUUID(), content })).json();
    const r = await f.post({ action: 'prepare', draftId: p.draft.draftId, expectedDraftRevision: s.draft.draftRevision, idempotencyKey: randomUUID() }); expect(r.status).toBe(200);
    const body = await r.json(), c = (await f.repository.getCandidate(f.scopeId, body.result.review.candidateId))!, funding = (await f.repository.getCalculation(f.scopeId, c.calculationIds.funding))!;
    expect(evidenceFromJson(funding.requestContext)).toMatchObject({ sourceState: 'not-requested' });
    const evidence = (await f.repository.getEvidence(f.scopeId, funding.captureIds[0]))!; expect(evidenceFromJson(evidence.payloadJson)).toMatchObject({ kind: 'returned', value: { days: [] } });
    const doc = JSON.stringify(c.document.json); expect(doc).not.toMatch(/ECOS 조회 실패|ECOS에|아직 공표 전/); expect(counts(f.repository)[0]).toBe(2);
  });
  it('factory failure writes no derived records and a final receipt failure rolls stage back', async () => {
    const f = await fixture(), p = await saved(f), command = { action: 'prepare', draftId: p.draft.draftId, expectedDraftRevision: 2, idempotencyKey: randomUUID() };
    const factory = f.deps.documentFactory; f.deps.documentFactory = () => { throw Error('SYNTHETIC sensitive storage detail'); };
    expect((await f.post(command)).status).toBe(503); expect(counts(f.repository)).toEqual([0,0,0,0,0,0,0]); f.deps.documentFactory = factory;
    const db = new DatabaseSync(f.repository.databasePath); db.exec("CREATE TRIGGER synthetic_fail BEFORE INSERT ON manual_entry_command WHEN NEW.action='prepare' BEGIN SELECT RAISE(ABORT,'SYNTHETIC'); END"); db.close();
    expect((await f.post(command)).status).toBe(503); expect(counts(f.repository)).toEqual([0,0,0,0,0,0,0]);
  });
  it('explicit first confirm preserves exact retries and ordinary correction reaches revision2', async () => {
    const f = await fixture(), p = await prepared(f), command = { action: 'confirm', draftId: p.draft.draftId, expectedDraftRevision: 2, candidateId: p.result.review.candidateId, documentHash: p.result.review.documentHash, expectedRevision: 0, idempotencyKey: randomUUID() };
    expect((await f.repository.currentHeads(f.scopeId, [p.draft.reportCycle]))[0].revision).toBe(0);
    expect(await confirmMonthlyReport(f.deps, f.scopeId, { candidateId: command.candidateId, expectedRevision: 0, idempotencyKey: randomUUID() })).toEqual({ kind: 'not-ready', reason: 'MANUAL_ENTRY_REQUIRED' });
    const response = await f.post(command); expect(response.status).toBe(200); const ack = await response.json(); expect(ack.result).toMatchObject({ kind: 'confirmed', revision: 1 });
    const correctionDeps: CorrectionDependencies = { ...f.deps, ecosCatalog: ECOS_SERIES };
    const editor = await prepareCorrectionEditor(correctionDeps, f.scopeId, ack.result.confirmationId);
    const row = editor.rows.find(r => r.category === 'cashflow' && r.label === '수입' && r.sourceRound === p.draft.reportCycle && r.period === p.draft.reportCycle)!;
    const draft = await createCorrectionDraft(correctionDeps, f.scopeId, { basisId: editor.basisId, idempotencyKey: randomUUID(), content: { edits: [{ rowId: row.rowId, action: 'set', rawValue: '11' }], reason: 'SYNTHETIC correction', evidenceNote: '' } });
    if (draft === 'empty') throw Error('synthetic correction');
    const preview = await previewCorrectionDraft(correctionDeps, f.scopeId, { draftId: draft.draftId, expectedDraftRevision: draft.draftRevision });
    expect(preview.kind).toBe('preview'); if (preview.kind !== 'preview') throw Error('synthetic preview');
    const second = await confirmCorrection(correctionDeps, f.scopeId, { previewId: preview.previewId, previewHash: preview.previewHash, expectedBaseRevision: 1, idempotencyKey: randomUUID(), reason: 'SYNTHETIC correction' }); expect(second).toMatchObject({ kind: 'confirmed', revision: 2 });
    expect(await (await f.post(command)).json()).toEqual(ack); expect(await (await f.post(p.prepareCommand)).json()).toEqual(p.prepareBody);
    expect((await (await f.get(`?draftId=${p.draft.draftId}`)).json()).draft.state).toBe('confirmed'); expect(f.forbidden).not.toHaveBeenCalled();
  });
  it('generic prepare rejects manual source metadata and calculation snapshots without writing', async () => {
    const f = await fixture(), p = await prepared(f), c = (await f.repository.getCandidate(f.scopeId, p.result.review.candidateId))!, input = (await f.repository.getInputSnapshot(f.scopeId, c.inputSnapshotId))!, before = counts(f.repository);
    const common = { scopeId: f.scopeId, basis: c.basis, statements: input.statements, sourceMetadata: { files: ['s1','s2','s3'] }, constructionCalculationId: c.calculationIds.construction, fundingCalculationId: c.calculationIds.funding, historySelectionId: c.historySelectionId, authoredAt: preparedAt, inputGeneration: 'synthetic' };
    await expect(prepareReportCandidate(f.deps, common, f.deps.documentFactory)).rejects.toThrow('MANUAL_ENTRY_REQUIRED');
    await expect(prepareReportCandidate(f.deps, { ...common, sourceMetadata: input.sourceMetadata }, f.deps.documentFactory)).rejects.toThrow('MANUAL_ENTRY_REQUIRED'); expect(counts(f.repository)).toEqual(before);
  });
  it('old prepare key returns its exact immutable summary and document after raw editing', async () => {
    const f = await fixture(), p = await prepared(f), before = counts(f.repository);
    expect(p.prepareBody.result.inputSummary).toMatchObject({ includedRounds: ['2026/06','2026/08','2026/09'], missingEconomic: [] });
    const changed = { ...p.content, note: 'SYNTHETIC new raw' };
    const edited = await f.post({ ...p.saveCommand, expectedDraftRevision: 2, idempotencyKey: randomUUID(), content: changed }); expect(edited.status).toBe(200);
    expect(await (await f.post(p.prepareCommand)).json()).toEqual(p.prepareBody);
    expect((await (await f.get(`?draftId=${p.draft.draftId}`)).json()).draft).toMatchObject({ state: 'editing', draftRevision: 3, currentReview: null });
    expect(counts(f.repository)).toEqual(before);
    expect((await f.post({ ...p.prepareCommand, idempotencyKey: randomUUID() })).status).toBe(409);
    expect((await f.post({ ...p.saveCommand, idempotencyKey: randomUUID() })).status).toBe(409);
    expect((await f.post({ ...p.prepareCommand, expectedDraftRevision: 3 })).status).toBe(409);
  });
  it('foreign scope cannot read a draft and manual review becomes month-conflict after an ordinary upload wins', async () => {
    const f = await fixture(), p = await prepared(f), c = (await f.repository.getCandidate(f.scopeId, p.result.review.candidateId))!, input = (await f.repository.getInputSnapshot(f.scopeId, c.inputSnapshotId))!;
    const foreign = await f.handlers.handleManualEntryGet(new Request(`http://localhost/api/report-history/manual-entries?draftId=${p.draft.draftId}`), async () => ({ ...await f.provider(), scopeId: randomUUID() })); expect(foreign.status).toBe(404);
    const ids: string[] = [];
    for (const indicator of ['construction','funding'] as const) { const original = (await f.repository.getCalculation(f.scopeId, c.calculationIds[indicator]))!; ids.push((await f.repository.putCalculation({ ...original, derivation: { kind: 'captured' }, captureIds: [] })).calculationId); }
    const upload = await prepareReportCandidate(f.deps, { scopeId: f.scopeId, basis: c.basis, statements: input.statements, sourceMetadata: { files: ['SYNTHETIC1.xlsx','SYNTHETIC2.xlsx','SYNTHETIC3.xlsx'] }, constructionCalculationId: ids[0], fundingCalculationId: ids[1], historySelectionId: c.historySelectionId, authoredAt: preparedAt, inputGeneration: 'SYNTHETIC-upload' }, f.deps.documentFactory);
    expect(await confirmMonthlyReport(f.deps, f.scopeId, { candidateId: upload.candidateId, expectedRevision: 0, idempotencyKey: randomUUID() })).toMatchObject({ kind: 'confirmed', revision: 1 });
    expect((await (await f.get(`?draftId=${p.draft.draftId}`)).json()).draft).toMatchObject({ state: 'month-conflict', existingConfirmation: { revision: 1 } });
    const conflict = await f.post({ ...p.prepareCommand, idempotencyKey: randomUUID() }); expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: 'REPORT_ALREADY_EXISTS' });
    expect(await (await f.post(p.prepareCommand)).json()).toEqual(p.prepareBody);
    const changedVersion = async () => ({ scopeId: f.scopeId, deps: { ...f.deps, calculationVersion: 'SYNTHETIC-next-version' } });
    const get = await f.handlers.handleManualEntryGet(new Request(`http://localhost/api/report-history/manual-entries?draftId=${p.draft.draftId}`), changedVersion);
    const list = await f.handlers.handleManualEntryGet(new Request('http://localhost/api/report-history/manual-entries?limit=12'), changedVersion);
    expect((await get.json()).draft.state).toBe('month-conflict'); expect((await list.json()).items[0].state).toBe('month-conflict');
  });
  it('a changed dependency head makes GET stale and a fresh review selects the new dependency', async () => {
    const f = await fixture(), prior = await prepared(f, '2026/07');
    const initial = await (await f.post({ action: 'confirm', draftId: prior.draft.draftId, expectedDraftRevision: 2, candidateId: prior.result.review.candidateId, documentHash: prior.result.review.documentHash, expectedRevision: 0, idempotencyKey: randomUUID() })).json();
    const current = await prepared(f), correctionDeps: CorrectionDependencies = { ...f.deps, ecosCatalog: ECOS_SERIES };
    expect(current.result.review.dependencyHeads).toMatchObject([{ revision: 1, confirmationId: initial.result.confirmationId }]);
    const editor = await prepareCorrectionEditor(correctionDeps, f.scopeId, initial.result.confirmationId), row = editor.rows.find(r => r.category === 'cashflow' && r.label === '수입' && r.sourceRound === prior.draft.reportCycle && r.period === prior.draft.reportCycle)!;
    const draft = await createCorrectionDraft(correctionDeps, f.scopeId, { basisId: editor.basisId, idempotencyKey: randomUUID(), content: { edits: [{ rowId: row.rowId, action: 'set', rawValue: '11' }], reason: 'SYNTHETIC dependency', evidenceNote: '' } }); if (draft === 'empty') throw Error('synthetic');
    const preview = await previewCorrectionDraft(correctionDeps, f.scopeId, { draftId: draft.draftId, expectedDraftRevision: draft.draftRevision }); if (preview.kind !== 'preview') throw Error('synthetic');
    await confirmCorrection(correctionDeps, f.scopeId, { previewId: preview.previewId, previewHash: preview.previewHash, expectedBaseRevision: 1, idempotencyKey: randomUUID(), reason: 'SYNTHETIC dependency' });
    const get = await (await f.get(`?draftId=${current.draft.draftId}`)).json(); expect(get.draft.state).toBe('stale-review'); expect(get.draft).not.toHaveProperty('review');
    const rejected = await f.post({ action: 'confirm', draftId: current.draft.draftId, expectedDraftRevision: 2, candidateId: current.result.review.candidateId, documentHash: current.result.review.documentHash, expectedRevision: 0, idempotencyKey: randomUUID() }); expect(rejected.status).toBe(409); expect(await rejected.json()).toMatchObject({ code: 'STALE_DEPENDENCY' });
    const reprepare = await f.post({ ...current.prepareCommand, idempotencyKey: randomUUID() }); expect(reprepare.status).toBe(200); const latest = await reprepare.json(); expect(latest.result.review.candidateId).not.toBe(current.result.review.candidateId); expect(latest.result.review.dependencyHeads).toMatchObject([{ revision: 2 }]);
  });
  it.each(['unit-only','reference-zero','last-average-missing'])('retains direct raw meaning for %s without fallback or unit conversion', async scenario => {
    const f = await fixture(), p = await saved(f), content = structuredClone(p.content);
    if (scenario === 'unit-only') for (const item of Object.values(content.economic)) for (const key of Object.keys(item.values)) Object.assign(item.values, { [key]: '' });
    if (scenario === 'reference-zero') for (const c of p.draft.catalog.economic) content.economic[c.key].values[c.referenceMonth] = '0';
    if (scenario === 'last-average-missing') { const last = structuredClone(content.funding.days[0]); last.rowId = randomUUID(); last.dateRaw = last.dateRaw.replace('-28', '-29'); last.publicAaa.averageRaw = ''; content.funding.days.push(last); }
    const updated = await (await f.post({ ...p.saveCommand, expectedDraftRevision: 2, idempotencyKey: randomUUID(), content })).json();
    const r = await f.post({ action: 'prepare', draftId: p.draft.draftId, expectedDraftRevision: updated.draft.draftRevision, idempotencyKey: randomUUID() }); expect(r.status).toBe(200); const body = await r.json();
    const candidate = (await f.repository.getCandidate(f.scopeId, body.result.review.candidateId))!, calc = (await f.repository.getCalculation(f.scopeId, scenario === 'last-average-missing' ? candidate.calculationIds.funding : candidate.calculationIds.construction))!;
    expect(evidenceFromJson(calc.resultJson)).toMatchObject({ ok: true, value: { result: { kind: 'unavailable' } } });
    if (scenario === 'unit-only') { const evidence = (await f.repository.getEvidence(f.scopeId, calc.captureIds[0]))!, observed = evidenceFromJson<{kind:'returned';value:SourceResult}>(evidence.payloadJson); expect(Object.values(observed.value).every(series => 'values' in series && series.values.size === 0 && series.unit === 'SYNTHETIC 공표 단위')).toBe(true); }
    expect(f.forbidden).not.toHaveBeenCalled();
  });
  it('GET and pending list both invalidate a review when the running calculation version changes', async () => {
    const f = await fixture(), p = await prepared(f), provider = async () => ({ scopeId: f.scopeId, deps: { ...f.deps, calculationVersion: 'SYNTHETIC-next-version' } });
    const get = await f.handlers.handleManualEntryGet(new Request(`http://localhost/api/report-history/manual-entries?draftId=${p.draft.draftId}`), provider); expect((await get.json()).draft.state).toBe('stale-review');
    const list = await f.handlers.handleManualEntryGet(new Request('http://localhost/api/report-history/manual-entries?limit=12'), provider); expect((await list.json()).items[0].state).toBe('stale-review');
  });
  it('prepare never invokes the individually committing writers', async () => {
    const f = await fixture(), p = await saved(f);
    for (const method of ['putEvidence','putCalculation','putInputSnapshot','putCandidate','createHistorySelection'] as const) vi.spyOn(f.repository, method).mockImplementation(async () => { throw Error('INDIVIDUAL_WRITER_FORBIDDEN'); });
    const response = await f.post({ action: 'prepare', draftId: p.draft.draftId, expectedDraftRevision: 2, idempotencyKey: randomUUID() }); expect(response.status).toBe(200); expect(counts(f.repository)).toEqual([2,1,2,1,1,1,0]);
  });
  it('fix1 I1 accepts Next normalized localhost URL with actual loopback Host/Origin', async () => {
    const f = await fixture();
    for (const host of ['127.0.0.1:3005','localhost:3005','[::1]:3005']) {
      const request = new Request('http://localhost:3005/api/report-history/manual-entries?limit=12', { headers: { host, origin: `http://${host}` } });
      const response = await f.handlers.handleManualEntryGet(request, f.provider); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
      const noOrigin = await f.handlers.handleManualEntryGet(new Request('http://localhost:3005/api/report-history/manual-entries?limit=12', { headers: { host } }), f.provider); expect(noOrigin.status).toBe(200);
    }
    const response = await f.handlers.handleManualEntryPost(new Request('http://localhost:3005/api/report-history/manual-entries', { method: 'POST', headers: { host: '127.0.0.1:3005', origin: 'http://127.0.0.1:3005' }, body: JSON.stringify({ action: 'create', reportTitleMonth: '2026/08', idempotencyKey: randomUUID() }) }), f.provider); expect(response.status).toBe(200);
  });
  it.each([
    { url: 'http://localhost:3005', host: '127.0.0.1:3005', origin: 'http://127.0.0.1:3006' },
    { url: 'http://localhost:3005', host: '127.0.0.1:3005', origin: 'http://localhost:3005' },
    { url: 'http://localhost:3005', host: '127.0.0.1:3005', origin: 'https://127.0.0.1:3005' },
    { url: 'http://localhost:3005', host: 'foreign.test:3005', origin: 'http://foreign.test:3005' },
    { url: 'http://foreign.test:3005', host: 'localhost:3005', origin: 'http://localhost:3005' },
  ])('fix1 I1 rejects mismatched Origin authority and nonloopback authorities %#', async authority => {
    const f = await fixture(), request = new Request(`${authority.url}/api/report-history/manual-entries?limit=12`, { headers: { host: authority.host, origin: authority.origin } });
    const response = await f.handlers.handleManualEntryGet(request, f.provider); expect(response.status).toBe(403); expect(await response.json()).toEqual({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' });
  });
  it('fix1 I2 rejects a first confirm after a running version change without a head or receipt', async () => {
    const f = await fixture(), p = await prepared(f), command = { action: 'confirm', draftId: p.draft.draftId, expectedDraftRevision: 2, candidateId: p.result.review.candidateId, documentHash: p.result.review.documentHash, expectedRevision: 0, idempotencyKey: randomUUID() };
    const changedVersion = async () => ({ scopeId: f.scopeId, deps: { ...f.deps, calculationVersion: 'SYNTHETIC-next-version' } });
    const response = await f.handlers.handleManualEntryPost(new Request('http://localhost/api/report-history/manual-entries', { method: 'POST', body: JSON.stringify(command) }), changedVersion);
    expect(response.status).toBe(422); expect(await response.json()).toEqual({ ok: false, code: 'UNSUPPORTED_VERSION' });
    expect((await f.repository.currentHeads(f.scopeId, [p.draft.reportCycle]))[0].revision).toBe(0); expect(await f.repository.getManualEntryCommand(f.scopeId, command.idempotencyKey)).toBeNull();
    const first = await (await f.post(command)).json(); expect(first.result).toMatchObject({ kind: 'confirmed', revision: 1 });
    const retry = await f.handlers.handleManualEntryPost(new Request('http://localhost/api/report-history/manual-entries', { method: 'POST', body: JSON.stringify(command) }), changedVersion); expect(retry.status).toBe(200); expect(await retry.json()).toEqual(first);
  });
  it('fix1 I2 preserves already-confirmed for a new key after a running version change', async () => {
    const f = await fixture(), p = await prepared(f), command = { action: 'confirm', draftId: p.draft.draftId, expectedDraftRevision: 2, candidateId: p.result.review.candidateId, documentHash: p.result.review.documentHash, expectedRevision: 0, idempotencyKey: randomUUID() };
    const first = await (await f.post(command)).json(); expect(first.result).toMatchObject({ kind: 'confirmed', revision: 1 });
    const before = counts(f.repository), heads = await f.repository.currentHeads(f.scopeId, [p.draft.reportCycle]);
    const changedVersion = async () => ({ scopeId: f.scopeId, deps: { ...f.deps, calculationVersion: 'SYNTHETIC-next-version' } });
    const newCommand = { ...command, idempotencyKey: randomUUID() };
    const response = await f.handlers.handleManualEntryPost(new Request('http://localhost/api/report-history/manual-entries', { method: 'POST', body: JSON.stringify(newCommand) }), changedVersion);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, result: { ...first.result, kind: 'already-confirmed' } });
    expect(counts(f.repository)).toEqual(before); expect(await f.repository.currentHeads(f.scopeId, [p.draft.reportCycle])).toEqual(heads);
    expect((await f.repository.getManualEntryCommand(f.scopeId, newCommand.idempotencyKey))?.acknowledgement).toEqual({ ...first.result, kind: 'already-confirmed' });
  });
  it('fix1 M2 maps an autosave arriving after confirmation to WORK_CLOSED409 without writes', async () => {
    const f = await fixture(), p = await prepared(f);
    const confirmation = await f.post({ action: 'confirm', draftId: p.draft.draftId, expectedDraftRevision: 2, candidateId: p.result.review.candidateId, documentHash: p.result.review.documentHash, expectedRevision: 0, idempotencyKey: randomUUID() }); expect(confirmation.status).toBe(200);
    const before = counts(f.repository), draft = await f.repository.getManualEntry(f.scopeId, p.draft.draftId), key = randomUUID();
    const response = await f.post({ ...p.saveCommand, expectedDraftRevision: 2, idempotencyKey: key, content: { ...p.content, note: 'SYNTHETIC late autosave' } }); expect(response.status).toBe(409); expect(await response.json()).toEqual({ ok: false, code: 'WORK_CLOSED' }); expect(response.headers.has('retry-after')).toBe(false);
    expect(counts(f.repository)).toEqual(before); expect(await f.repository.getManualEntry(f.scopeId, p.draft.draftId)).toEqual(draft); expect(await f.repository.getManualEntryCommand(f.scopeId, key)).toBeNull();
    expect(await (await f.post(p.saveCommand)).json()).toEqual(p.saveBody);
  });
  it.each(['?draftId=bad','?limit=13','?limit=12&scopeId=foreign','?limit=12&limit=12','?draftId=11111111-1111-4111-8111-111111111111&cursor=x','?unknown=x'])('rejects strict GET query %s', async query => { const f = await fixture(); expect((await f.get(query)).status).toBe(422); });
  it.each([
    { action: 'create', reportTitleMonth: '2026/08', idempotencyKey: randomUUID(), scopeId: 'foreign' },
    { action: 'create', reportTitleMonth: '2026/13', idempotencyKey: randomUUID() },
    { action: 'prepare', draftId: randomUUID(), expectedDraftRevision: 0, idempotencyKey: randomUUID() },
    { action: 'confirm', draftId: randomUUID(), expectedDraftRevision: 1, candidateId: randomUUID(), documentHash: 'x', expectedRevision: 0, idempotencyKey: randomUUID() },
    { action: 'confirm', draftId: randomUUID(), expectedDraftRevision: 1, candidateId: randomUUID(), documentHash: 'a'.repeat(64), expectedRevision: 1, idempotencyKey: randomUUID() },
  ])('rejects malformed action-specific command %#', async body => { const f = await fixture(); expect((await f.post(body)).status).toBe(422); });
  it('rejects hostile Host/Origin, body streaming oversize, unknown fields and hides storage details', async () => {
    const f = await fixture(); expect((await f.get('?limit=12', { host: 'foreign.test' })).status).toBe(403); expect((await f.get('?limit=12', { origin: 'https://foreign.test' })).status).toBe(403);
    expect((await f.post({ action: 'create', reportTitleMonth: '2026/08', idempotencyKey: randomUUID() }, '?scopeId=x')).status).toBe(422);
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(6 * 1024 * 1024 + 1)); controller.close(); } });
    const request = new Request('http://localhost/api/report-history/manual-entries', { method: 'POST', body, duplex: 'half' } as RequestInit);
    const large = await f.handlers.handleManualEntryPost(request, f.provider); expect(large.status).toBe(413); expect(large.headers.get('cache-control')).toBe('no-store');
    const failure = await f.handlers.handleManualEntryGet(new Request('http://localhost/api/report-history/manual-entries?limit=12'), async () => { throw Error('secret storage path SYNTHETIC'); }); expect(failure.status).toBe(503); expect(failure.headers.get('retry-after')).toBe('1'); expect(await failure.json()).toEqual({ ok: false, code: 'STORAGE_UNAVAILABLE' });
    const c = await created(f), content = ready(c.draft); content.note = 'x'.repeat(2001); expect((await f.post({ action: 'save', draftId: c.draft.draftId, expectedDraftRevision: 1, idempotencyKey: randomUUID(), content })).status).toBe(413);
    expect((await f.get(`?draftId=${randomUUID()}`)).status).toBe(404);
  });
});
