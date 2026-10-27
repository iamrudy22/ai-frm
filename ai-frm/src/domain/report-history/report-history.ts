import { addMonths, parseYearMonth, type YearMonth } from '../shared/year-month';
export const HISTORY_CALCULATION_VERSION = 'risk-policy-2026-09-28@e3a8f9e';
export const HISTORY_TEMPLATE_VERSION = 'report@e3a8f9e';
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
} | ManualEntryDerivation;
export type ManualEntryDerivation = { readonly kind: 'manual-input'; readonly draftId: string; readonly draftRevision: number; readonly rawInputHash: string; readonly recordedAt: string };
/** Exact variant shape prevents unknown lineage from being silently treated as captured. */
export function isDerivation(value: unknown): value is Derivation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const exact = (keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
  if (v.kind === 'captured') return exact(['kind']);
  // Existing correction IDs/hashes predate the UUID/SHA contract. Preserve their string contract.
  if (v.kind === 'manual-correction') return exact(['kind', 'importId', 'patchHash', 'parentId', 'correctedAt']) && ['importId', 'patchHash', 'parentId', 'correctedAt'].every(key => typeof v[key] === 'string');
  if (v.kind !== 'manual-input' || !exact(['kind', 'draftId', 'draftRevision', 'rawInputHash', 'recordedAt'])) return false;
  if (typeof v.draftId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.draftId) || !Number.isSafeInteger(v.draftRevision) || (v.draftRevision as number) < 1 || typeof v.rawInputHash !== 'string' || !/^[0-9a-f]{64}$/i.test(v.rawInputHash)) return false;
  if (typeof v.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.recordedAt)) return false;
  const parsed = new Date(v.recordedAt);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === v.recordedAt;
}
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
/** Read-only chart selection permits a chosen construction or Gap month; confirmation remains canonical. */
export function validHistorySelectionBasis(basis: ReportBasis): boolean {
  try {
    for (const month of Object.values(basis)) parseYearMonth(month);
    return basis.reportTitleMonth === addMonths(basis.reportCycle, -1) &&
      basis.fundingJudgedMonth === basis.reportCycle &&
      basis.fundingObservedMonth === addMonths(basis.reportCycle, -1);
  } catch { return false; }
}
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
