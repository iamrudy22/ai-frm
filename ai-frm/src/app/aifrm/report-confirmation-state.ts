import type { PreparedCandidate } from '@/application/report-history/report-candidate';
import type { PreparedDocument } from '@/domain/report-history/report-history';
import type { YearMonth } from '@/domain/shared/year-month';

export type AcceptedCandidate = {
  readonly key: string;
  readonly candidate: PreparedCandidate;
  readonly previewRequired: boolean;
  readonly idempotencyKey: string;
};

export type ConfirmationAttempt = { readonly key: string; readonly candidateId: string; readonly expectedRevision: number;
  readonly idempotencyKey: string; readonly correctionReason?: string };
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
  request: typeof fetch = fetch): Promise<PreparedDocument> {
  const response = await request(`/api/report-history/confirmations?confirmationId=${encodeURIComponent(id)}`, { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw Error(body.code ?? 'STORAGE_UNAVAILABLE');
  cancelBackfill();
  return body.document as PreparedDocument;
}
