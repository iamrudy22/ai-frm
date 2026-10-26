import { addMonths, compareYearMonth, parseYearMonth, type YearMonth } from '@/domain/shared/year-month';
import { HISTORY_CALCULATION_VERSION } from '@/domain/report-history/report-history';
import type { ExternalHistoryView, HistorySourceCounts, HistorySourceSummary } from '@/application/report-history/history-view';
import { summarizeHistory } from './report-chart-view';
import type { FinancialReport, ReportMetric, ReportPoint } from './report-model';

export type HistoryProjectionBasis = { readonly construction: YearMonth; readonly funding: YearMonth; readonly scopeId?: string };

/** Summarize the visible chart points; an archived document owns its current anchor. */
export function summarizeHistorySources(report: FinancialReport, view: ExternalHistoryView,
  anchorSource: 'current' | 'confirmed'): HistorySourceSummary {
  const confirmed = new Set(view.confirmedCalculationIds ?? []);
  const count = (indicator: 'construction' | 'funding'): HistorySourceCounts => {
    const anchor = view.anchors[indicator];
    const visible = report.metrics.find(metric => metric.id === indicator)?.points ?? [];
    const result = { confirmed: 0, backfill: 0, unconfirmed: 0, current: 0 };
    for (const point of visible) {
      if (point.kind !== 'available') continue;
      if (point.month === anchor) { result[anchorSource]++; continue; }
      const source = view.points.find(item => item.indicator === indicator && item.point.month === point.month);
      if (!source || source.point.kind !== 'available' || source.point.value !== point.value) continue;
      if (confirmed.has(source.calculationId)) result.confirmed++;
      else if (source.origin === 'reconstructed') result.backfill++;
      else result.unconfirmed++;
    }
    return result;
  };
  return { construction: count('construction'), funding: count('funding') };
}

/** The selected, immutable view changes chart history only. The current report point always owns its month. */
export function withExternalRiskHistory(report: FinancialReport, view: ExternalHistoryView, basis?: HistoryProjectionBasis): FinancialReport {
  if (view.calculationVersion !== HISTORY_CALCULATION_VERSION) throw Error('HISTORY_VERSION_MISMATCH');
  if (basis?.scopeId !== undefined && view.scopeId !== basis.scopeId) throw Error('HISTORY_SCOPE_MISMATCH');
  const cycle = parseYearMonth(report.latestRound);
  const expected = basis ?? {
    construction: report.metrics.find(m => m.id === 'construction')?.points.at(-1)?.month ?? addMonths(cycle, -2),
    funding: report.metrics.find(m => m.id === 'funding')?.points.at(-1)?.month ?? addMonths(cycle, -1),
  };
  if (view.anchors.construction !== expected.construction || view.anchors.funding !== expected.funding) throw Error('HISTORY_ANCHOR_MISMATCH');
  const metric = (original: ReportMetric): ReportMetric => {
    if (original.id !== 'construction' && original.id !== 'funding') return original;
    const anchor = view.anchors[original.id];
    const from = addMonths(anchor, -17);
    const chosen = new Map<YearMonth, ReportPoint>();
    for (const item of view.points) {
      if (item.unit !== (item.indicator === 'construction' ? 'index' : 'percentage-points')) throw Error('HISTORY_UNIT_MISMATCH');
      if (item.indicator !== original.id) continue;
      parseYearMonth(item.point.month);
      if (compareYearMonth(item.point.month, from) >= 0 && compareYearMonth(item.point.month, anchor) < 0) {
        if (chosen.has(item.point.month)) throw Error('DUPLICATE_HISTORY_MONTH');
        if (item.point.kind === 'available' && !Number.isFinite(item.point.value)) throw Error('INVALID_HISTORY_VALUE');
        chosen.set(item.point.month, item.point);
      }
    }
    const current = original.points.find(p => p.month === anchor) ?? { month: anchor, kind: 'missing' as const, value: null, reason: original.narrative };
    const points: ReportPoint[] = [];
    for (let month = from; compareYearMonth(month, anchor) <= 0; month = addMonths(month, 1)) {
      points.push(month === anchor ? current : chosen.get(month) ?? { month, kind: 'missing', value: null, reason: '선택한 이력에 산출값이 없습니다.' });
    }
    const coverage = summarizeHistory(points);
    return { ...original, points, historyCoverage: coverage, historyNote: `선택한 외부 산출 이력 ${coverage.availableMonths.length}개월 확보 · 누락월은 연결하지 않음. 현재 ${original.status}: ${original.narrative}` };
  };
  return { ...report, metrics: report.metrics.map(metric) };
}
