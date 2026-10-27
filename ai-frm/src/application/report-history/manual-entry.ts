import { createBlankManualEntryContent, createManualEntryCatalog, manualEntryRequestHashInput, normalizeManualEntry, validateManualEntryContent, type ConfirmManualEntryCommand, type CreateManualEntryCommand, type ManualEconomicDefinition, type ManualEntryDraftDto, type ManualEntryFieldError, type ManualEntryInputSummary, type ManualEntryReviewRef, type ManualEntrySourceMetadataV1, type PrepareManualEntryCommand, type SaveManualEntryCommand, type StoredManualEntryDraft } from '../../domain/report-history/manual-entry';
import { HISTORY_TEMPLATE_VERSION, type PreparedDocument } from '../../domain/report-history/report-history';
import { assessPerception } from '../construction-perception';
import { assessFundingRiskReport } from '../funding-risk';
import { assessDashboard } from '../dashboard';
import { ledgerOf } from '../../domain/cashflow/forecast-ledger';
import { roundEntryOf } from '../../domain/cashflow/round-entry';
import { calendarOf } from '../../domain/cashflow/statement';
import { addMonths } from '../../domain/shared/year-month';
import { restoreStatement, type ReportDocumentFactory } from './report-candidate';
import { HistoryOperationError, type HistoryDependencies, type ManualEntryRepositoryPorts, type ManualEntryListQuery, type ManualEntryStageWrite, type StoredCalculation, type StoredEvidence, type StoredInputSnapshot, type SourceObservation, type RevisionToken } from './ports';
import type { SourceResult, YieldFetch } from '../ports';

export type ManualEntryDependencies = Omit<HistoryDependencies, 'repository'> & {
  readonly repository: HistoryDependencies['repository'] & ManualEntryRepositoryPorts;
  readonly nextId: () => string;
  readonly ecosCatalog: readonly ManualEconomicDefinition[];
  readonly documentFactory: ReportDocumentFactory;
};
export type ManualEntryPrepareResult = { readonly kind: 'ready'; readonly review: ManualEntryReviewRef; readonly document: PreparedDocument; readonly inputSummary: ManualEntryInputSummary } | { readonly kind: 'invalid'; readonly errors: readonly ManualEntryFieldError[] };
const fail = (code: ConstructorParameters<typeof HistoryOperationError>[0]): never => { throw new HistoryOperationError(code); };
function requestHash(deps: ManualEntryDependencies, action: 'create' | 'save' | 'prepare' | 'confirm', command: CreateManualEntryCommand | SaveManualEntryCommand | PrepareManualEntryCommand | ConfirmManualEntryCommand) { return deps.hash(manualEntryRequestHashInput(action, command)); }
async function receipt<T>(deps: ManualEntryDependencies, scopeId: string, action: 'create' | 'save' | 'prepare' | 'confirm', command: CreateManualEntryCommand | SaveManualEntryCommand | PrepareManualEntryCommand | ConfirmManualEntryCommand): Promise<T | null> {
  const previous = await deps.repository.getManualEntryCommand(scopeId, command.idempotencyKey);
  if (!previous) return null;
  if (previous.action !== action || previous.requestHash !== requestHash(deps, action, command)) return fail('IDEMPOTENCY_KEY_REUSED');
  return previous.acknowledgement as unknown as T;
}
async function load(deps: ManualEntryDependencies, scopeId: string, draftId: string) { return await deps.repository.getManualEntry(scopeId, draftId) ?? fail('NOT_FOUND'); }
function checkVersion(deps: ManualEntryDependencies, draft: StoredManualEntryDraft) {
  if (draft.catalog.calculationVersion !== deps.calculationVersion || draft.catalog.templateVersion !== HISTORY_TEMPLATE_VERSION) fail('UNSUPPORTED_VERSION');
}
async function reviewRecords(deps: ManualEntryDependencies, scopeId: string, ref: ManualEntryReviewRef) {
  const candidate = await deps.repository.getCandidate(scopeId, ref.candidateId);
  if (!candidate || candidate.documentHash !== ref.documentHash || candidate.document.contentHash !== ref.documentHash || deps.hash(candidate.document.json) !== ref.documentHash) return fail('UNSUPPORTED_VERSION');
  const input = await deps.repository.getInputSnapshot(scopeId, candidate.inputSnapshotId);
  const metadata = input && deps.decode?.<ManualEntrySourceMetadataV1>(input.sourceMetadata);
  if (!input || !metadata?.inputSummary) return fail('UNSUPPORTED_VERSION');
  return { candidate, input, inputSummary: metadata.inputSummary };
}
async function reviewResult(deps: ManualEntryDependencies, scopeId: string, review: ManualEntryReviewRef): Promise<Extract<ManualEntryPrepareResult, { kind: 'ready' }>> {
  const { candidate, inputSummary } = await reviewRecords(deps, scopeId, review);
  return { kind: 'ready', review, document: candidate.document, inputSummary };
}
/** ACK projection only uses the acknowledged immutable revision. GET evaluates current heads separately. */
async function acknowledgement(deps: ManualEntryDependencies, draft: StoredManualEntryDraft): Promise<ManualEntryDraftDto> {
  const { scopeId, ...raw } = draft;
  const review = draft.currentReview ? await reviewResult(deps, scopeId, draft.currentReview) : null;
  return { ...raw, state: draft.confirmationId ? 'confirmed' : review ? 'review-ready' : 'editing', ...(review ? { review: { ref: review.review, document: review.document, inputSummary: review.inputSummary } } : {}) };
}
async function dependencyCurrent(deps: ManualEntryDependencies, scopeId: string, tokens: readonly RevisionToken[]) {
  const current = await deps.repository.currentHeads(scopeId, tokens.map(token => token.reportCycle));
  return tokens.every(token => current.some(head => deps.hash(head) === deps.hash(token)));
}
export async function createManualEntry(deps: ManualEntryDependencies, scopeId: string, command: CreateManualEntryCommand): Promise<ManualEntryDraftDto> {
  const old = await receipt<StoredManualEntryDraft>(deps, scopeId, 'create', command);
  if (old) return acknowledgement(deps, old);
  const catalog = createManualEntryCatalog(command.reportTitleMonth, deps.ecosCatalog), content = createBlankManualEntryContent(catalog), now = deps.metadataClock().toISOString();
  const draft: StoredManualEntryDraft = { recordKind: 'manual-entry-draft', payloadVersion: 1, scopeId, draftId: deps.nextId(), reportCycle: catalog.reportCycle, draftRevision: 1, catalog, content, rawInputHash: deps.hash(content), createdAt: now, savedAt: now, currentReview: null, confirmationId: null };
  return acknowledgement(deps, await deps.repository.createManualEntry({ scopeId, command, requestHash: requestHash(deps, 'create', command), draft }));
}
export async function saveManualEntry(deps: ManualEntryDependencies, scopeId: string, command: SaveManualEntryCommand): Promise<ManualEntryDraftDto> {
  const old = await receipt<StoredManualEntryDraft>(deps, scopeId, 'save', command);
  if (old) return acknowledgement(deps, old);
  const draft = await load(deps, scopeId, command.draftId);
  if (validateManualEntryContent(draft.catalog, command.content).kind === 'invalid') return fail('INVALID_DRAFT');
  return acknowledgement(deps, await deps.repository.saveManualEntry(scopeId, command));
}
export async function getManualEntry(deps: ManualEntryDependencies, scopeId: string, draftId: string): Promise<ManualEntryDraftDto> {
  const draft = await load(deps, scopeId, draftId), dto = await acknowledgement(deps, draft);
  const [head] = await deps.repository.currentHeads(scopeId, [draft.reportCycle]);
  if (draft.confirmationId) return dto;
  if (head?.confirmationId) return { ...dto, state: 'month-conflict', existingConfirmation: { confirmationId: head.confirmationId, revision: head.revision } };
  if (draft.currentReview && (draft.catalog.calculationVersion !== deps.calculationVersion || draft.catalog.templateVersion !== HISTORY_TEMPLATE_VERSION || !await dependencyCurrent(deps, scopeId, draft.currentReview.dependencyHeads))) return { ...dto, state: 'stale-review', review: undefined };
  return dto;
}
export async function listManualEntries(deps: ManualEntryDependencies, scopeId: string, query: ManualEntryListQuery) {
  const page = await deps.repository.listManualEntries(scopeId, query);
  const items = await Promise.all(page.items.map(async summary => {
    const draft = await load(deps, scopeId, summary.draftId);
    return summary.state !== 'month-conflict' && draft.currentReview && (draft.catalog.calculationVersion !== deps.calculationVersion || draft.catalog.templateVersion !== HISTORY_TEMPLATE_VERSION)
      ? { ...summary, state: 'stale-review' as const } : summary;
  }));
  return { ...page, items };
}

export async function prepareManualEntry(deps: ManualEntryDependencies, scopeId: string, command: PrepareManualEntryCommand): Promise<ManualEntryPrepareResult> {
  const old = await receipt<ManualEntryReviewRef>(deps, scopeId, 'prepare', command);
  if (old) return reviewResult(deps, scopeId, old);
  const draft = await load(deps, scopeId, command.draftId);
  if (draft.draftRevision !== command.expectedDraftRevision) return fail('STALE_DRAFT');
  checkVersion(deps, draft);
  const [head] = await deps.repository.currentHeads(scopeId, [draft.reportCycle]);
  if (head?.confirmationId || draft.confirmationId) return fail('REPORT_ALREADY_EXISTS');
  const normalized = normalizeManualEntry(draft.catalog, draft.content);
  if (normalized.kind === 'invalid') return normalized;
  const binding = { draftId: draft.draftId, draftRevision: draft.draftRevision, rawInputHash: draft.rawInputHash };
  const stageCommand = { idempotencyKey: command.idempotencyKey, requestHash: requestHash(deps, 'prepare', command) };
  const expectedHead = { reportCycle: draft.reportCycle, confirmationId: null, revision: 0 } as const;
  if (draft.currentReview && await dependencyCurrent(deps, scopeId, draft.currentReview.dependencyHeads)) {
    const { candidate, input } = await reviewRecords(deps, scopeId, draft.currentReview);
    const selection = await deps.repository.getHistorySelection(scopeId, candidate.historySelectionId);
    const calculations = await Promise.all([candidate.calculationIds.construction, candidate.calculationIds.funding].map(id => deps.repository.getCalculation(scopeId, id)));
    if (!selection || calculations.some(c => !c)) return fail('UNSUPPORTED_VERSION');
    const evidence = await Promise.all(calculations.flatMap(c => c!.captureIds).map(id => deps.repository.getEvidence(scopeId, id)));
    if (evidence.some(e => !e)) return fail('UNSUPPORTED_VERSION');
    const review = await deps.repository.stageManualEntry({ scopeId, draft: binding, command: stageCommand, expectedHead, selection, evidence: evidence as StoredEvidence[], input, calculations: calculations as StoredCalculation[], candidate: { ...candidate, manualEntry: binding }, review: draft.currentReview });
    return reviewResult(deps, scopeId, review);
  }
  const preparedAt = deps.metadataClock().toISOString(), evaluated = new Date(deps.clock().getTime()), evaluatedAt = evaluated.toISOString();
  const derivation = { kind: 'manual-input', ...binding, recordedAt: draft.savedAt } as const;
  const statements = normalized.statements.map(restoreStatement), latest = statements.at(-1)!;
  const previous = statements.find(s => calendarOf(s, s.defaultBaseMonth) === addMonths(draft.reportCycle, -1)) ?? null;
  const ledger = ledgerOf(statements.flatMap(statement => { try { return [roundEntryOf(statement)]; } catch { return []; } }));
  const ledgerInput = ledger.rounds().map(round => ledger.entryOf(round));
  const economic = Object.fromEntries(draft.catalog.economic.map(c => { const series = normalized.economic.find(s => s.key === c.key); return [c.key, { values: new Map(series?.values.map(v => [v.month, v.value]) ?? []), unit: series?.unit ?? '' }]; })) as unknown as SourceResult;
  const fundingRaw: YieldFetch = { days: normalized.yields, fetchedAt: new Date(draft.savedAt) };
  const traces: string[][] = [[], []], used = [false, false];
  const clock = (index: number) => () => { traces[index].push(evaluatedAt); return new Date(evaluated.getTime()); };
  const constructionRequest = { reportMonth: draft.reportCycle }, fundingRequest = { judgedMonth: draft.reportCycle };
  const constructionOutcome = await assessPerception({ fetchAll: async () => { used[0] = true; return economic; } }, ledger, constructionRequest, clock(0));
  const fundingOutcome = await assessFundingRiskReport({ dailyYields: async () => { used[1] = true; return fundingRaw; } }, fundingRequest, clock(1));
  const evidence: StoredEvidence[] = ([['ecos', economic], ['kofia', fundingRaw]] as const).map(([sourceKind, value]) => {
    const observation: SourceObservation<SourceResult | YieldFetch> = { kind: 'returned', value };
    return { scopeId, captureId: deps.nextId(), sourceKind, contentHash: deps.hash(observation), payloadJson: deps.encode(observation), schemaVersion: 1, receivedAt: draft.savedAt, derivation };
  });
  const metadata: ManualEntrySourceMetadataV1 = { kind: 'manual-input', payloadVersion: 1, ...binding, recordedAt: draft.savedAt,
    statementSources: normalized.statements.map(s => { const round = calendarOf(restoreStatement(s), restoreStatement(s).defaultBaseMonth); return { round, asOf: s.asOf, label: `직접 입력 · 자료 ${round} · 기준일 ${s.asOf.year}-${String(s.asOf.month).padStart(2, '0')}-${String(s.asOf.day).padStart(2, '0')}` }; }),
    economicSource: 'user-entered-published-series', fundingSource: 'user-entered-published-averages', note: draft.content.note.trim(), inputSummary: normalized.inputSummary };
  const input: StoredInputSnapshot = { scopeId, inputSnapshotId: deps.nextId(), statements: normalized.statements, inputHash: deps.hash(normalized.statements), sourceMetadata: deps.encode(metadata), derivation, createdAt: preparedAt };
  const calculations: StoredCalculation[] = (['construction', 'funding'] as const).map((indicator, index) => {
    const request = index === 0 ? constructionRequest : fundingRequest, calculationInput = index === 0 ? ledgerInput : fundingRequest;
    return { scopeId, calculationId: deps.nextId(), indicator, origin: 'live', derivation, effectiveMonth: index === 0 ? draft.catalog.basis.constructionBaseMonth : draft.catalog.basis.fundingObservedMonth,
      requestContext: deps.encode({ request, input: calculationInput, sourceState: used[index] ? 'returned' : 'not-requested' }), inputHash: deps.hash(calculationInput), calculationVersion: deps.calculationVersion, captureIds: [evidence[index].captureId], resultJson: deps.encode(index === 0 ? constructionOutcome : fundingOutcome), evaluatedAt, evaluationClockTrace: traces[index], evaluatedCalendar: { year: evaluated.getFullYear(), month: evaluated.getMonth() + 1, day: evaluated.getDate() }, evaluationTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, createdAt: preparedAt };
  });
  const selection = await deps.repository.planHistorySelection({ scopeId, basis: draft.catalog.basis, calculationVersion: deps.calculationVersion, asOf: preparedAt, selectedBackfillBatchId: null });
  const document = deps.documentFactory({ statements, sourceMetadata: input.sourceMetadata, dashboard: assessDashboard(previous, latest, latest.defaultBaseMonth), constructionOutcome, fundingOutcome, basis: draft.catalog.basis, authoredAt: new Date(preparedAt) }, selection);
  if (document.schemaVersion !== 1 || document.templateVersion !== draft.catalog.templateVersion || document.contentHash !== deps.hash(document.json) || deps.hash(document.historyCalculationIds) !== deps.hash(selection.historyCalculationIds)) return fail('INVALID_DRAFT');
  const candidate: ManualEntryStageWrite['candidate'] = { scopeId, candidateId: deps.nextId(), basis: draft.catalog.basis, inputSnapshotId: input.inputSnapshotId, inputHash: input.inputHash, calculationInputHashes: { construction: calculations[0].inputHash, funding: calculations[1].inputHash }, calculationVersion: deps.calculationVersion, authoredAt: preparedAt, preparedAt, calculationIds: { construction: calculations[0].calculationId, funding: calculations[1].calculationId }, historySelectionId: selection.historySelectionId, document, correctionPreviewId: null, manualEntry: binding };
  const review: ManualEntryReviewRef = { ...binding, candidateId: candidate.candidateId, documentHash: document.contentHash, preparedAt, evaluatedAt, dependencyHeads: selection.headRevisions };
  const staged = await deps.repository.stageManualEntry({ scopeId, draft: binding, command: stageCommand, expectedHead, selection, evidence, input, calculations, candidate, review });
  return reviewResult(deps, scopeId, staged);
}
export async function confirmManualEntry(deps: ManualEntryDependencies, scopeId: string, command: ConfirmManualEntryCommand) {
  const old = await receipt<Awaited<ReturnType<ManualEntryRepositoryPorts['commitManualEntry']>>>(deps, scopeId, 'confirm', command);
  if (old) return old;
  const draft = await load(deps, scopeId, command.draftId);
  if (!draft.confirmationId) checkVersion(deps, draft);
  return deps.repository.commitManualEntry(scopeId, command);
}
