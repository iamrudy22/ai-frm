import type { YearMonth } from '@/domain/shared/year-month';
import type { HistoryIndicator, CalculationOrigin } from '@/domain/report-history/report-history';

/** Plain JSON returned to the browser. Stored calculations and codec tags never cross this boundary. */
export type ExternalHistoryPoint = {
  readonly calculationId: string;
  readonly indicator: HistoryIndicator;
  readonly origin: CalculationOrigin;
  readonly unit: 'index' | 'percentage-points';
  readonly point: { readonly month: YearMonth } & (
    | { readonly kind: 'available'; readonly value: number }
    | { readonly kind: 'missing'; readonly value: null; readonly reason: string }
  );
};
export type ExternalHistoryView = {
  readonly historySelectionId: string;
  readonly scopeId: string;
  readonly calculationVersion: string;
  readonly anchors: { readonly construction: YearMonth; readonly funding: YearMonth };
  readonly cutoff: string;
  readonly selectedBackfillBatchId: string | null;
  /** Canonical calculation IDs from the immutable confirmations named by headRevisions. */
  readonly confirmedCalculationIds?: readonly string[];
  readonly points: readonly ExternalHistoryPoint[];
};

export type HistorySourceCounts = { readonly confirmed: number; readonly backfill: number; readonly unconfirmed: number; readonly current: number };
export type HistorySourceSummary = { readonly construction: HistorySourceCounts; readonly funding: HistorySourceCounts };
