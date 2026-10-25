import type { ExternalHistorySelection, HistoryRepository } from '@/application/report-history/ports';
import type { ExternalHistoryPoint, ExternalHistoryView } from '@/application/report-history/history-view';
import { HISTORY_CALCULATION_VERSION, validHistorySelectionBasis, type JsonValue, type ReportBasis } from '@/domain/report-history/report-history';
import { addMonths, parseYearMonth, type YearMonth } from '@/domain/shared/year-month';
import { bodyOf, json, localOrigin } from './report-history-handlers';

type Provider = () => Promise<{ readonly scopeId: string; readonly repository: HistoryRepository; readonly decode: (value: ExternalHistorySelection['calculations'][number]['resultJson']) => unknown; readonly now: () => Date }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function id(value: unknown): string { if (typeof value !== 'string' || !uuid.test(value)) throw Error('INVALID_SELECTION_ID'); return value; }
function month(value: unknown): YearMonth { if (typeof value !== 'string') throw Error('INVALID_MONTH'); try { return parseYearMonth(value); } catch { throw Error('INVALID_MONTH'); } }
function basisOf(body: Record<string, unknown>): ReportBasis {
  if (Object.keys(body).some(key => !['reportCycle', 'constructionBaseMonth', 'gapMonth', 'selectedBackfillBatchId'].includes(key))) throw Error('INVALID_SELECTION_INPUT');
  const reportCycle = month(body.reportCycle);
  const basis = { reportCycle, reportTitleMonth: addMonths(reportCycle, -1), constructionBaseMonth: month(body.constructionBaseMonth), fundingJudgedMonth: reportCycle, fundingObservedMonth: addMonths(reportCycle, -1), gapMonth: month(body.gapMonth) };
  if (!validHistorySelectionBasis(basis)) throw Error('INVALID_BASIS');
  return basis;
}
function resultPoint(calculation: ExternalHistorySelection['calculations'][number], decoded: unknown): ExternalHistoryPoint {
  const outcome = decoded as { ok?: unknown; reason?: unknown; value?: { result?: Record<string, unknown> } };
  const result = outcome?.value?.result;
  const unit = calculation.indicator === 'construction' ? 'index' : 'percentage-points';
  const failure = (reason: string): ExternalHistoryPoint => ({ calculationId: calculation.calculationId, indicator: calculation.indicator, origin: calculation.origin, unit,
    point: { month: calculation.effectiveMonth, kind: 'missing', value: null, reason } });
  if (outcome?.ok === false) return failure(typeof outcome.reason === 'string' ? outcome.reason : '저장된 산출에 실패했습니다.');
  if (outcome?.ok !== true || !result || typeof result !== 'object') throw Error('INVALID_STORED_RESULT');
  const observed = calculation.indicator === 'construction' ? result.month : result.observedMonth;
  if (observed !== calculation.effectiveMonth) throw Error('INVALID_STORED_MONTH');
  if (result.kind === 'unavailable') {
    const reason = calculation.indicator === 'construction' && Array.isArray(result.missing)
      ? result.missing.map((item: { key?: unknown; reason?: unknown }) => `${String(item.key)}: ${String(item.reason)}`).join(' / ')
      : result.reason;
    return failure(typeof reason === 'string' && reason ? reason : '필요한 원천값이 없어 산출하지 못했습니다.');
  }
  if (result.kind !== 'ok') throw Error('INVALID_STORED_RESULT');
  const value = calculation.indicator === 'construction' ? result.index : result.spread;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('INVALID_STORED_VALUE');
  return { calculationId: calculation.calculationId, indicator: calculation.indicator, origin: calculation.origin, unit,
    point: { month: calculation.effectiveMonth, kind: 'available', value } };
}
export function selectionView(selection: ExternalHistorySelection, decode: (value: JsonValue) => unknown): ExternalHistoryView {
  if (selection.calculationVersion !== HISTORY_CALCULATION_VERSION) throw Error('UNSUPPORTED_CALCULATION_VERSION');
  return { historySelectionId: selection.historySelectionId, scopeId: selection.scopeId, calculationVersion: selection.calculationVersion,
    anchors: selection.anchors, cutoff: selection.cutoff, selectedBackfillBatchId: selection.selectedBackfillBatchId,
    points: selection.calculations.map(calculation => {
      if (calculation.scopeId !== selection.scopeId || calculation.calculationVersion !== selection.calculationVersion) throw Error('INVALID_SELECTION_RECORD');
      return resultPoint(calculation, decode(calculation.resultJson));
    }) };
}
function failure(error: unknown): Response {
  const code = error instanceof Error ? error.message : 'STORAGE_UNAVAILABLE';
  const status = code === 'SELECTION_NOT_FOUND' || code === 'NOT_FOUND_OR_WRONG_SCOPE' ? 404 :
    code === 'BATCH_RANGE_MISMATCH' || code === 'BATCH_VERSION_MISMATCH' || code === 'UNSUPPORTED_CALCULATION_VERSION' ? 422 :
    code === 'BODY_TOO_LARGE' ? 413 : /^INVALID_/.test(code) ? 400 : 503;
  const safeCode = status === 503 ? 'STORAGE_UNAVAILABLE' : status === 404 ? 'HISTORY_NOT_FOUND' : code;
  return json({ ok: false, code: safeCode }, status, status === 503 ? { 'Retry-After': '1' } : undefined);
}
export async function handleHistorySelectionPost(request: Request, provider: Provider): Promise<Response> {
  try {
    if (!localOrigin(request)) return json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403);
    const body = await bodyOf(request);
    const basis = basisOf(body);
    const selectedBackfillBatchId = body.selectedBackfillBatchId === null || body.selectedBackfillBatchId === undefined ? null : id(body.selectedBackfillBatchId);
    const { scopeId, repository, decode, now } = await provider();
    const selection = await repository.createHistorySelection({ scopeId, basis, calculationVersion: HISTORY_CALCULATION_VERSION, asOf: now().toISOString(), selectedBackfillBatchId });
    return json({ ok: true, view: selectionView(selection, decode) });
  } catch (error) { return failure(error); }
}
export async function handleHistorySelectionGet(request: Request, provider: Provider): Promise<Response> {
  try {
    if (!localOrigin(request)) return json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403);
    const selectionId = id(new URL(request.url).searchParams.get('historySelectionId'));
    const { scopeId, repository, decode } = await provider();
    const selection = await repository.getHistorySelection(scopeId, selectionId);
    if (!selection) throw Error('SELECTION_NOT_FOUND');
    return json({ ok: true, view: selectionView(selection, decode) });
  } catch (error) { return failure(error); }
}
