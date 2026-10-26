import type { PreparedCandidate } from '@/application/report-history/report-candidate';
import type { PreparedDocument } from '@/domain/report-history/report-history';
import type { YearMonth } from '@/domain/shared/year-month';
import type { HistorySourceSummary } from '@/application/report-history/history-view';

export type AcceptedCandidate = {
  readonly key: string;
  readonly candidate: PreparedCandidate;
  readonly previewRequired: boolean;
  readonly idempotencyKey: string;
};

export type ConfirmationAttempt = { readonly key: string; readonly candidateId: string; readonly expectedRevision: number;
  readonly idempotencyKey: string; readonly correctionReason?: string };
export type ArchivedReport = { readonly document: PreparedDocument; readonly historySources: HistorySourceSummary };
type CorrectionSuccessState = {
  readonly candidateState: AcceptedCandidate | null;
  readonly candidatePreparingKey: string | null;
  readonly confirmationKey: string | null;
  readonly candidatePreparationKey: string | null;
  readonly confirmationAttempt: ConfirmationAttempt | null;
  readonly confirmationConflictKey: string | null;
  readonly confirmed: { key: string; id: string } | null;
  readonly archived: (ArchivedReport & { id?: string }) | null;
  readonly appliedGeneration: number;
  readonly correctionRefreshRevision: number;
};

export function correctionSuccessState<T extends CorrectionSuccessState>(current: T): Omit<CorrectionSuccessState, 'archived' | 'appliedGeneration' | 'correctionRefreshRevision'> & { archived: T['archived']; appliedGeneration: (current: number) => number; correctionRefreshRevision: (current: number) => number } {
  return { ...current, candidateState: null, candidatePreparingKey: null, confirmationKey: null,
    candidatePreparationKey: null, confirmationAttempt: null, confirmationConflictKey: null, confirmed: null,
    appliedGeneration: value => value + 1, correctionRefreshRevision: value => value + 1 };
}

export function reportDisplayOf<T>(archived: ArchivedReport | null, candidate: AcceptedCandidate | null,
  projectedReport: T | null, currentSources: (report: T) => HistorySourceSummary | null): { report: T | null; sources: HistorySourceSummary | null } {
  if (archived) return { report: archived.document.json as T, sources: archived.historySources };
  const report = candidate?.previewRequired ? candidate.candidate.document.json as T : projectedReport;
  return { report, sources: report === null ? null : currentSources(report) };
}

export type ExportRequest = { readonly confirmationId: string; readonly generation: number };
export function exportRequestMatches(current: ExportRequest | null, requested: ExportRequest): boolean {
  return current?.confirmationId === requested.confirmationId && current.generation === requested.generation;
}

export function confirmationAttemptForClick(previous: ConfirmationAttempt | null, key: string, candidateId: string,
  expectedRevision: number, idempotencyKey: string, correctionReason: string): ConfirmationAttempt {
  if (previous?.key === key) return previous;
  return { key, candidateId, expectedRevision, idempotencyKey,
    ...(expectedRevision > 0 ? { correctionReason: correctionReason.trim() } : {}) };
}

export function attemptAfterFailureResponse(attempt: ConfirmationAttempt, status: number): ConfirmationAttempt | null {
  return status >= 400 && status < 500 && status !== 408 && status !== 429 ? null : attempt;
}

function canonical(value: unknown): string {
  const plain = JSON.parse(JSON.stringify(value));
  const sorted = (item: unknown): unknown => Array.isArray(item) ? item.map(sorted) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sorted(entry)])) : item;
  return JSON.stringify(sorted(plain));
}

export function acceptPreparedCandidate(currentKey: string | null, requestKey: string, candidate: PreparedCandidate,
  displayedDocument: unknown, nextKey: () => string): AcceptedCandidate | null {
  if (!currentKey || currentKey !== requestKey) return null;
  return { key: requestKey, candidate, previewRequired: canonical(candidate.document.json) !== canonical(displayedDocument), idempotencyKey: nextKey() };
}

export function revisionForCycle(confirmations: readonly { reportCycle: YearMonth; revision: number }[], loaded: boolean, cycle: YearMonth | null): number | null {
  if (!loaded || cycle === null) return null;
  return Math.max(0, ...confirmations.filter(item => item.reportCycle === cycle).map(item => item.revision));
}

export async function fetchArchivedDocument(id: string, cancelBackfill: () => void,
  request: typeof fetch = fetch, isCurrent: () => boolean = () => true): Promise<{ document: PreparedDocument; historySources: HistorySourceSummary }> {
  const response = await request(`/api/report-history/confirmations?confirmationId=${encodeURIComponent(id)}`, { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw Error(body.code ?? 'STORAGE_UNAVAILABLE');
  if (!body.document || !body.historySources) throw Error('INVALID_ARCHIVED_RESPONSE');
  if (isCurrent()) cancelBackfill();
  return { document: body.document as PreparedDocument, historySources: body.historySources as HistorySourceSummary };
}
