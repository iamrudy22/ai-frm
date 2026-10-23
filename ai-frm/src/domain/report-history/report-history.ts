import { addMonths, parseYearMonth, type YearMonth } from '../shared/year-month';
export type HistoryIndicator = 'construction' | 'funding';
export type CalculationOrigin = 'live' | 'reconstructed';
export type Derivation = {
  readonly kind: 'captured';
} | {
  readonly kind: 'manual-correction';
  readonly importId: string;
  readonly patchHash: string;
  readonly parentId: string;
  readonly correctedAt: string;
};
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | {
  readonly [key: string]: JsonValue;
};
export type ReportBasis = {
  readonly reportCycle: YearMonth;
  readonly reportTitleMonth: YearMonth;
  readonly constructionBaseMonth: YearMonth;
  readonly fundingJudgedMonth: YearMonth;
  readonly fundingObservedMonth: YearMonth;
  readonly gapMonth: YearMonth;
};
export type PreparedDocument = {
  readonly schemaVersion: 1;
  readonly templateVersion: string;
  readonly contentHash: string;
  readonly json: JsonValue;
  readonly historyCalculationIds: readonly string[];
};
export type ConfirmationCommand = {
  readonly candidateId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly correctionReason?: string;
};
export type ConfirmationResult = {
  readonly kind: 'confirmed' | 'already-confirmed';
  readonly confirmationId: string;
  readonly revision: number;
} | {
  readonly kind: 'conflict' | 'not-ready';
  readonly reason: string;
};
export type ConfirmationDecision = {
  readonly kind: 'create';
  readonly revision: number;
} | {
  readonly kind: 'conflict' | 'not-ready';
  readonly reason: string;
};
export type HistoryReceipt = {
  readonly captureStatus: 'saved';
  readonly calculationId: string;
  readonly contextHash: string;
} | {
  readonly captureStatus: 'failed';
  readonly code: 'STORAGE_UNAVAILABLE';
};
export type CapturedOutcome<T> = {
  readonly outcome: T;
  readonly history: HistoryReceipt;
};
/** Revision is a compare-and-swap token; only a new revision may change the head. */
export function confirmDecision(basis: ReportBasis, currentRevision: number, expectedRevision: number, correctionReason?: string): ConfirmationDecision {
  try {
    for (const month of Object.values(basis)) parseYearMonth(month);
    const cycle = basis.reportCycle;
    if (
      basis.reportTitleMonth !== addMonths(cycle, -1) ||
      basis.constructionBaseMonth !== addMonths(cycle, -2) ||
      basis.fundingJudgedMonth !== cycle ||
      basis.fundingObservedMonth !== addMonths(cycle, -1) ||
      basis.gapMonth !== cycle
    ) return { kind: 'not-ready', reason: 'INVALID_BASIS' };
  }
  catch {
    return { kind: 'not-ready', reason: 'INVALID_BASIS' };
  }
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    return { kind: 'not-ready', reason: 'INVALID_REVISION' };
  if (currentRevision !== expectedRevision)
    return { kind: 'conflict', reason: 'STALE_BASE' };
  if (currentRevision > 0 && !correctionReason?.trim())
    return { kind: 'not-ready', reason: 'CORRECTION_REASON_REQUIRED' };
  return { kind: 'create', revision: currentRevision + 1 };
}
