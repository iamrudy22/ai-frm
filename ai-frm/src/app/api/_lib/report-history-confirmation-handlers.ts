import { prepareReportCandidate, confirmMonthlyReport, openConfirmedReport, type PrepareCandidateInput, type ReportDocumentFactory } from '@/application/report-history/report-candidate';
import type { HistoryDependencies, StatementSnapshotDto } from '@/application/report-history/ports';
import { HISTORY_TEMPLATE_VERSION, type JsonValue, type ReportBasis } from '@/domain/report-history/report-history';
import { parseYearMonth, type YearMonth } from '@/domain/shared/year-month';
import { arrangeRounds } from '@/app/aifrm/uploaded-rounds';
import { buildFinancialReport } from '@/app/aifrm/report-model';
import { summarizeHistorySources, withExternalRiskHistory } from '@/app/aifrm/report-history-projection';
import { qualifiedSelectionView, selectionView } from './report-history-selection-handlers';
import { bodyOf, json, localOrigin } from './report-history-handlers';
import type { PerceptionResponse } from '@/app/api/construction-perception/dto';
import type { FundingRiskResponse } from '@/app/api/funding-risk/dto';
import type { FinancialReport } from '@/app/aifrm/report-model';

type Provider = () => Promise<{ readonly scopeId: string; readonly deps: HistoryDependencies }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (value: unknown): string => typeof value === 'string' && uuid.test(value) ? value : invalid('INVALID_ID');
const invalid = (code: string): never => { throw Error(code); };
const month = (value: unknown): YearMonth => {
  if (typeof value !== 'string') return invalid('INVALID_MONTH');
  try { return parseYearMonth(value); }
  catch { return invalid('INVALID_MONTH'); }
};
function basisOf(raw: unknown): ReportBasis {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('INVALID_BASIS');
  const b = raw as Record<string, unknown>;
  if (Object.keys(b).sort().join('|') !== ['reportCycle','reportTitleMonth','constructionBaseMonth','fundingJudgedMonth','fundingObservedMonth','gapMonth'].sort().join('|')) return invalid('INVALID_BASIS');
  return { reportCycle: month(b.reportCycle), reportTitleMonth: month(b.reportTitleMonth), constructionBaseMonth: month(b.constructionBaseMonth),
    fundingJudgedMonth: month(b.fundingJudgedMonth), fundingObservedMonth: month(b.fundingObservedMonth), gapMonth: month(b.gapMonth) };
}
function prepareInput(body: Record<string, unknown>, scopeId: string): PrepareCandidateInput {
  if (Object.keys(body).some(key => !['action','basis','statements','sourceMetadata','constructionCalculationId','fundingCalculationId','historySelectionId','authoredAt','inputGeneration'].includes(key))) return invalid('INVALID_PREPARE_INPUT');
  if (!Array.isArray(body.statements) || body.statements.length === 0 ||
    typeof body.authoredAt !== 'string' || typeof body.inputGeneration !== 'string' || body.inputGeneration.length > 200 ||
    !body.sourceMetadata || typeof body.sourceMetadata !== 'object' || Array.isArray(body.sourceMetadata)) return invalid('INVALID_PREPARE_INPUT');
  return { scopeId, basis: basisOf(body.basis), statements: body.statements as StatementSnapshotDto[], sourceMetadata: body.sourceMetadata as JsonValue,
    constructionCalculationId: id(body.constructionCalculationId), fundingCalculationId: id(body.fundingCalculationId), historySelectionId: id(body.historySelectionId),
    authoredAt: body.authoredAt, inputGeneration: body.inputGeneration };
}

export function reportDocumentFactory(deps: HistoryDependencies, scopeId: string): ReportDocumentFactory {
  return (input, selection) => {
    const metadata = input.sourceMetadata as Record<string, unknown>;
    const names = metadata?.files;
    if (!Array.isArray(names) || names.length !== input.statements.length || !names.every(name => typeof name === 'string' && name.length > 0 && name.length <= 255)) throw Error('INVALID_SOURCE_METADATA');
    const arranged = arrangeRounds(input.statements.map((statement, index) => ({ statement, file: names[index] })));
    if (!arranged.ok) throw Error('INVALID_ROUNDS');
    const raw = buildFinancialReport({ rounds: arranged.rounds, dashboard: input.dashboard, gapMonth: input.basis.gapMonth,
      perception: JSON.parse(JSON.stringify(input.constructionOutcome)) as PerceptionResponse,
      funding: JSON.parse(JSON.stringify(input.fundingOutcome)) as FundingRiskResponse, generatedAt: input.authoredAt });
    const view = selectionView(selection, value => deps.decode?.(value));
    const report = withExternalRiskHistory(raw, view, { construction: input.basis.constructionBaseMonth, funding: input.basis.fundingObservedMonth, scopeId });
    const plain = JSON.parse(JSON.stringify(report)) as JsonValue;
    return { schemaVersion: 1, templateVersion: HISTORY_TEMPLATE_VERSION, contentHash: deps.hash(plain), json: plain, historyCalculationIds: selection.historyCalculationIds };
  };
}

function failure(error: unknown): Response {
  const code = error instanceof Error ? error.message : 'STORAGE_UNAVAILABLE';
  const status = code === 'CONFIRMATION_NOT_FOUND' || code === 'CALCULATION_NOT_FOUND' ? 404 :
    code === 'BODY_TOO_LARGE' ? 413 :
    code === 'STALE_BASE' || code === 'IDEMPOTENCY_KEY_REUSED' ? 409 :
    /^INVALID_|_MISMATCH$|^UNSUPPORTED_|^HISTORY_SELECTION_MISMATCH$/.test(code) ? 422 : 503;
  return json({ ok: false, code: status === 503 ? 'STORAGE_UNAVAILABLE' : code }, status, status === 503 ? { 'Retry-After': '1' } : undefined);
}
export async function handleConfirmationPost(request: Request, provider: Provider): Promise<Response> {
  try {
    if (!localOrigin(request)) return json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403);
    const body = await bodyOf(request, 6_000_000);
    const { scopeId, deps } = await provider();
    if (body.action === 'prepare') {
      const input = prepareInput(body, scopeId);
      if (deps.isUnsafe(input.sourceMetadata)) return invalid('INVALID_SOURCE_METADATA');
      const candidate = await prepareReportCandidate(deps, input, reportDocumentFactory(deps, scopeId));
      return json({ ok: true, candidate });
    }
    if (body.action === 'confirm') {
      if (Object.keys(body).some(key => !['action','candidateId','expectedRevision','idempotencyKey','correctionReason'].includes(key)) ||
        !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0 ||
        typeof body.idempotencyKey !== 'string' || !uuid.test(body.idempotencyKey) ||
        (body.correctionReason !== undefined && (typeof body.correctionReason !== 'string' || body.correctionReason.length > 2000))) return invalid('INVALID_CONFIRM_COMMAND');
      const result = await confirmMonthlyReport(deps, scopeId, { candidateId: id(body.candidateId), expectedRevision: body.expectedRevision as number,
        idempotencyKey: body.idempotencyKey, ...(typeof body.correctionReason === 'string' ? { correctionReason: body.correctionReason } : {}) });
      return json({ ok: result.kind === 'confirmed' || result.kind === 'already-confirmed', result },
        result.kind === 'conflict' ? 409 : result.kind === 'not-ready' ? 422 : 200);
    }
    return invalid('INVALID_ACTION');
  } catch (error) { return failure(error); }
}
export async function handleConfirmationGet(request: Request, provider: Provider): Promise<Response> {
  try {
    if (!localOrigin(request)) return json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403);
    const { scopeId, deps } = await provider();
    const url = new URL(request.url);
    const confirmationId = url.searchParams.get('confirmationId');
    if (confirmationId) {
      const confirmedId = id(confirmationId);
      const document = await openConfirmedReport(deps.repository, scopeId, confirmedId);
      if (deps.hash(document.json) !== document.contentHash) throw Error('INVALID_DOCUMENT_HASH');
      const confirmation = await deps.repository.getConfirmation(scopeId, confirmedId);
      if (!confirmation || confirmation.scopeId !== scopeId) throw Error('CONFIRMATION_NOT_FOUND');
      const selection = await deps.repository.getHistorySelection(scopeId, confirmation.historySelectionId);
      if (!selection || selection.scopeId !== scopeId || selection.historySelectionId !== confirmation.historySelectionId) throw Error('INVALID_SELECTION_RECORD');
      const view = await qualifiedSelectionView(selection, deps.repository, value => deps.decode?.(value));
      const historySources = summarizeHistorySources(document.json as FinancialReport, view, 'confirmed');
      return json({ ok: true, document, historySources });
    }
    const summaries = await deps.repository.listConfirmations(scopeId);
    return json({ ok: true, confirmations: [...summaries].sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt)) });
  } catch (error) { return failure(error); }
}
