import { assessDashboard, type Dashboard } from '../dashboard';
import { calendarOf, createStatement, type ItemName, type Statement, type StatementInput, type Unreadable } from '../../domain/cashflow/statement';
import { roundEntryOf } from '../../domain/cashflow/round-entry';
import { ledgerOf } from '../../domain/cashflow/forecast-ledger';
import { addMonths } from '../../domain/shared/year-month';
import { HISTORY_TEMPLATE_VERSION, validHistorySelectionBasis, type ConfirmationCommand, type ConfirmationResult, type JsonValue, type PreparedDocument, type ReportBasis } from '../../domain/report-history/report-history';
import type { ExternalHistorySelection, HistoryDependencies, HistoryRepository, StatementSnapshotDto } from './ports';

const ITEMS: readonly ItemName[] = ['기초시재', '수입계', '수입', '분양회수', '기타수입', '지출'];
const fail = (code: string): never => { throw Error(code); };

export function snapshotStatement(statement: Statement): StatementSnapshotDto {
  const unreadable = new Map(statement.unreadableItems().map(value => [value.item, value.reason]));
  const amounts = Object.fromEntries(ITEMS.map(item => [item, unreadable.has(item)
    ? { unreadable: unreadable.get(item)! }
    : statement.months.map(month => statement.amountOf(item, month))])) as Record<ItemName, readonly number[] | Unreadable>;
  return { asOf: { year: statement.asOf.getFullYear(), month: statement.asOf.getMonth() + 1, day: statement.asOf.getDate() },
    monthLabels: statement.months.map(month => month.label), baseMonthIndex: statement.defaultBaseMonth.index,
    planYearEndIndex: statement.planYearEnd.index, amounts };
}

export function restoreStatement(dto: StatementSnapshotDto): Statement {
  if (!dto || typeof dto !== 'object' || !dto.asOf || !Number.isSafeInteger(dto.asOf.year) || dto.asOf.year < 1000 || dto.asOf.year > 9999 ||
    !Number.isSafeInteger(dto.asOf.month) || !Number.isSafeInteger(dto.asOf.day)) return fail('INVALID_STATEMENT');
  const asOf = new Date(dto.asOf.year, dto.asOf.month - 1, dto.asOf.day);
  if (asOf.getFullYear() !== dto.asOf.year || asOf.getMonth() + 1 !== dto.asOf.month || asOf.getDate() !== dto.asOf.day ||
    !Array.isArray(dto.monthLabels) || dto.monthLabels.length < 1 ||
    !Array.from(dto.monthLabels.keys()).every(index => Object.hasOwn(dto.monthLabels, index)) ||
    !dto.monthLabels.every(label => typeof label === 'string' && label.length > 0) ||
    !Number.isSafeInteger(dto.baseMonthIndex) || !Number.isSafeInteger(dto.planYearEndIndex) ||
    !dto.amounts || typeof dto.amounts !== 'object' || Array.isArray(dto.amounts) ||
    Object.keys(dto.amounts).sort().join('|') !== [...ITEMS].sort().join('|')) return fail('INVALID_STATEMENT');
  for (const item of ITEMS) {
    const series = dto.amounts[item];
    if (Array.isArray(series)) {
      if (series.length !== dto.monthLabels.length || !Array.from(series.keys()).every(index => Object.hasOwn(series, index) && typeof series[index] === 'number' && Number.isFinite(series[index]))) return fail('INVALID_STATEMENT');
    } else if (!series || typeof series !== 'object' || Array.isArray(series) || Object.keys(series).join('|') !== 'unreadable' ||
      typeof (series as Unreadable).unreadable !== 'string' || !(series as Unreadable).unreadable.trim()) return fail('INVALID_STATEMENT');
  }
  try { return createStatement({ asOf, monthLabels: [...dto.monthLabels], baseMonthIndex: dto.baseMonthIndex,
    planYearEndIndex: dto.planYearEndIndex, amounts: dto.amounts as StatementInput['amounts'] }); }
  catch { return fail('INVALID_STATEMENT'); }
}

export type PrepareCandidateInput = {
  readonly scopeId: string;
  readonly basis: ReportBasis;
  readonly statements: readonly StatementSnapshotDto[];
  readonly sourceMetadata: JsonValue;
  readonly constructionCalculationId: string;
  readonly fundingCalculationId: string;
  readonly historySelectionId: string;
  readonly authoredAt: string;
  readonly inputGeneration: string;
};
export type RestoredReportInput = {
  readonly statements: readonly Statement[];
  readonly sourceMetadata: JsonValue;
  readonly dashboard: Dashboard;
  readonly constructionOutcome: unknown;
  readonly fundingOutcome: unknown;
  readonly basis: ReportBasis;
  readonly authoredAt: Date;
};
export type ReportDocumentFactory = (input: RestoredReportInput, selection: ExternalHistorySelection) => PreparedDocument;
export type PreparedCandidate = { readonly candidateId: string; readonly documentHash: string; readonly document: PreparedDocument; readonly basis: ReportBasis; readonly inputGeneration: string };

function decodedContext(deps: HistoryDependencies, value: JsonValue): { request?: Record<string, unknown>; input?: unknown } {
  const decoded = deps.decode?.<unknown>(value);
  if (!decoded || typeof decoded !== 'object') return fail('INVALID_CALCULATION_CONTEXT');
  return decoded as { request?: Record<string, unknown>; input?: unknown };
}

export async function prepareReportCandidate(deps: HistoryDependencies, input: PrepareCandidateInput, documentFactory: ReportDocumentFactory): Promise<PreparedCandidate> {
  if (!validHistorySelectionBasis(input.basis) || input.basis.constructionBaseMonth !== addMonths(input.basis.reportCycle, -2) || input.basis.gapMonth !== input.basis.reportCycle)
    return fail('INVALID_BASIS');
  const authoredAt = new Date(input.authoredAt);
  if (!Number.isFinite(authoredAt.getTime()) || authoredAt.toISOString() !== input.authoredAt) return fail('INVALID_AUTHORED_AT');
  if (!Array.isArray(input.statements) || input.statements.length === 0 || !input.inputGeneration) return fail('INVALID_STATEMENT');
  const statements = input.statements.map(restoreStatement);
  const cycles = statements.map(statement => calendarOf(statement, statement.defaultBaseMonth));
  if (new Set(cycles).size !== cycles.length || cycles.some((cycle, index) => index > 0 && cycles[index - 1] >= cycle) || cycles.at(-1) !== input.basis.reportCycle) return fail('INVALID_REPORT_CYCLE');
  const latest = statements.at(-1)!;
  const previous = statements.find(statement => calendarOf(statement, statement.defaultBaseMonth) === addMonths(input.basis.reportCycle, -1)) ?? null;
  const gapMonth = latest.months.find(month => calendarOf(latest, month) === input.basis.gapMonth);
  if (!gapMonth) return fail('INVALID_GAP_MONTH');
  const entries = statements.flatMap(statement => { try { return [roundEntryOf(statement)]; } catch { return []; } });
  const ledger = ledgerOf(entries);
  const ledgerInput = ledger.rounds().map(round => ledger.entryOf(round));
  const construction = await deps.repository.getCalculation(input.scopeId, input.constructionCalculationId);
  const funding = await deps.repository.getCalculation(input.scopeId, input.fundingCalculationId);
  if (!construction || !funding) return fail('CALCULATION_NOT_FOUND');
  if (construction.scopeId !== input.scopeId || funding.scopeId !== input.scopeId || construction.calculationVersion !== deps.calculationVersion || funding.calculationVersion !== deps.calculationVersion ||
    construction.indicator !== 'construction' || funding.indicator !== 'funding' || construction.effectiveMonth !== input.basis.constructionBaseMonth || funding.effectiveMonth !== input.basis.fundingObservedMonth ||
    construction.inputHash !== deps.hash(ledgerInput) || funding.inputHash !== deps.hash({ judgedMonth: input.basis.fundingJudgedMonth })) return fail('CALCULATION_CONTEXT_MISMATCH');
  const constructionContext = decodedContext(deps, construction.requestContext);
  const fundingContext = decodedContext(deps, funding.requestContext);
  if (constructionContext.request?.reportMonth !== input.basis.reportCycle ||
    (constructionContext.request?.baseMonth ?? addMonths(input.basis.reportCycle, -2)) !== input.basis.constructionBaseMonth ||
    deps.hash(constructionContext.input) !== construction.inputHash || fundingContext.request?.judgedMonth !== input.basis.fundingJudgedMonth ||
    deps.hash(fundingContext.input) !== funding.inputHash) return fail('CALCULATION_CONTEXT_MISMATCH');
  const selection = await deps.repository.getHistorySelection(input.scopeId, input.historySelectionId);
  if (!selection || selection.scopeId !== input.scopeId || selection.calculationVersion !== deps.calculationVersion ||
    !selection.basis || deps.hash(selection.basis) !== deps.hash(input.basis) ||
    selection.anchors.construction !== input.basis.constructionBaseMonth || selection.anchors.funding !== input.basis.fundingObservedMonth) return fail('HISTORY_SELECTION_MISMATCH');
  const constructionOutcome = deps.decode?.<unknown>(construction.resultJson);
  const fundingOutcome = deps.decode?.<unknown>(funding.resultJson);
  const document = documentFactory({ statements, sourceMetadata: input.sourceMetadata, dashboard: assessDashboard(previous, latest, gapMonth), constructionOutcome, fundingOutcome, basis: input.basis, authoredAt }, selection);
  if (document.schemaVersion !== 1 || document.templateVersion !== HISTORY_TEMPLATE_VERSION ||
    deps.hash(document.json) !== document.contentHash ||
    JSON.stringify(document.historyCalculationIds) !== JSON.stringify(selection.historyCalculationIds)) return fail('INVALID_DOCUMENT');
  const numericalSnapshots = statements.map(snapshotStatement);
  const inputHash = deps.hash(numericalSnapshots);
  const saved = await deps.repository.putInputSnapshot({ scopeId: input.scopeId, statements: numericalSnapshots, sourceMetadata: input.sourceMetadata,
    inputHash, derivation: { kind: 'captured' }, createdAt: deps.metadataClock().toISOString() });
  const stored = await deps.repository.getInputSnapshot(input.scopeId, saved.inputSnapshotId);
  if (!stored || stored.inputHash !== inputHash || deps.hash(stored.statements) !== inputHash ||
    JSON.stringify(stored.statements.map(restoreStatement).map(snapshotStatement)) !== JSON.stringify(numericalSnapshots)) return fail('INPUT_SNAPSHOT_MISMATCH');
  const preparedAt = deps.metadataClock().toISOString();
  const candidate = await deps.repository.putCandidate({ scopeId: input.scopeId, basis: input.basis, inputSnapshotId: saved.inputSnapshotId,
    inputHash, calculationInputHashes: { construction: construction.inputHash, funding: funding.inputHash }, calculationVersion: deps.calculationVersion,
    authoredAt: input.authoredAt, preparedAt, calculationIds: { construction: input.constructionCalculationId, funding: input.fundingCalculationId },
    historySelectionId: input.historySelectionId, document, correctionPreviewId: null });
  return { candidateId: candidate.candidateId, documentHash: candidate.documentHash, document, basis: input.basis, inputGeneration: input.inputGeneration };
}

export async function confirmMonthlyReport(deps: HistoryDependencies, scopeId: string, cmd: ConfirmationCommand): Promise<ConfirmationResult> {
  const candidate = await deps.repository.getCandidate(scopeId, cmd.candidateId);
  if (!candidate) return { kind: 'not-ready', reason: 'CANDIDATE_NOT_FOUND' };
  if (candidate.correctionPreviewId !== null) return { kind: 'not-ready', reason: 'CORRECTION_PREVIEW_REQUIRED' };
  return deps.repository.commitConfirmation(scopeId, cmd);
}

export async function openConfirmedReport(repository: HistoryRepository, scopeId: string, id: string): Promise<PreparedDocument> {
  const confirmation = await repository.getConfirmation(scopeId, id);
  if (!confirmation) return fail('CONFIRMATION_NOT_FOUND');
  const document = confirmation.document;
  if (document.schemaVersion !== 1 || document.templateVersion !== HISTORY_TEMPLATE_VERSION) return fail('UNSUPPORTED_VERSION');
  return document;
}
