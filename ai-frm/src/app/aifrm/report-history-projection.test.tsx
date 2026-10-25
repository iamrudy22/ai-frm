import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { addMonths, parseYearMonth as ym } from '@/domain/shared/year-month';
import { summarizeHistory } from './report-chart-view';
import type { FinancialReport, ReportMetric } from './report-model';
import type { ExternalHistoryView } from '@/application/report-history/history-view';
import { withExternalRiskHistory } from './report-history-projection';
import { FinancialReportPreview } from './report-preview';

const construction = ym('2026/07'), funding = ym('2026/08');
const metric = (id: ReportMetric['id'], month = construction): ReportMetric => {
  const points = [{ month, kind: 'missing' as const, value: null, reason: '현재 산출 불가' }];
  return { id, title: id, value: '—', status: '산출 불가', grade: null, basis: '현재 기준', narrative: '현재 산출 불가', formula: '원래 산식', source: '원래 원천', points, historyCoverage: summarizeHistory(points), historyNote: '원래 안내' };
};
const report: FinancialReport = { title: '원래 제목', reportMonth: '2026/09', latestRound: '2026/09', generatedOn: '2026.10.23', isTemplate: false, warnings: ['원래 경고'], referenceTrends: null, metrics: [metric('recovery'), metric('liquidity'), metric('construction'), metric('funding', funding), metric('cash')] };
const view: ExternalHistoryView = { historySelectionId: 'fixed-id', scopeId: 'default', calculationVersion: 'risk-policy-2026-09-28@e3a8f9e', anchors: { construction, funding }, cutoff: '2026-10-23T00:00:00.000Z', selectedBackfillBatchId: null,
  points: [
    { calculationId: 'a', indicator: 'construction', origin: 'reconstructed', unit: 'index', point: { month: ym('2025/02'), kind: 'available', value: 0 } },
    { calculationId: 'b', indicator: 'construction', origin: 'live', unit: 'index', point: { month: ym('2026/05'), kind: 'available', value: -1.25 } },
    { calculationId: 'c', indicator: 'construction', origin: 'reconstructed', unit: 'index', point: { month: construction, kind: 'available', value: 9 } },
    { calculationId: 'f-old', indicator: 'funding', origin: 'reconstructed', unit: 'percentage-points', point: { month: ym('2026/07'), kind: 'available', value: -0.23 } },
    { calculationId: 'd', indicator: 'funding', origin: 'reconstructed', unit: 'percentage-points', point: { month: funding, kind: 'available', value: 2 } },
    { calculationId: 'future', indicator: 'funding', origin: 'live', unit: 'percentage-points', point: { month: ym('2026/09'), kind: 'available', value: 8 } },
  ] };

describe('external history projection', () => {
  it('keeps two distinct 18 month windows, gaps, zero and negative values, and current failure at each anchor', () => {
    const frozen = structuredClone(report);
    const result = withExternalRiskHistory(report, view);
    expect(report).toEqual(frozen);
    expect(result.metrics.filter(m => !['construction', 'funding'].includes(m.id))).toEqual(report.metrics.filter(m => !['construction', 'funding'].includes(m.id)));
    for (const id of ['construction', 'funding'] as const) {
      const original = report.metrics.find(m => m.id === id)!;
      const next = result.metrics.find(m => m.id === id)!;
      expect({ ...next, points: original.points, historyCoverage: original.historyCoverage, historyNote: original.historyNote }).toEqual(original);
      expect(next.points).toHaveLength(18);
      expect(next.points.at(-1)).toEqual(original.points[0]);
    }
    const c = result.metrics.find(m => m.id === 'construction')!;
    const f = result.metrics.find(m => m.id === 'funding')!;
    expect(c.points[0].month).toBe(addMonths(construction, -17));
    expect(f.points[0].month).toBe(addMonths(funding, -17));
    expect(c.points.find(p => p.month === ym('2025/02'))).toMatchObject({ kind: 'available', value: 0 });
    expect(c.points.find(p => p.month === ym('2026/05'))).toMatchObject({ kind: 'available', value: -1.25 });
    expect(c.points.find(p => p.month === ym('2026/06'))).toMatchObject({ kind: 'missing' });
    expect(f.points.find(p => p.month === ym('2026/09'))).toBeUndefined();
    expect(result).toMatchObject({ title: report.title, generatedOn: report.generatedOn, warnings: report.warnings });
  });
  it('rejects a mismatched month, version or unit rather than rendering the wrong selection', () => {
    expect(() => withExternalRiskHistory(report, { ...view, anchors: { construction: funding, funding } })).toThrow('HISTORY_ANCHOR_MISMATCH');
    expect(() => withExternalRiskHistory(report, { ...view, calculationVersion: 'other' })).toThrow('HISTORY_VERSION_MISMATCH');
    expect(() => withExternalRiskHistory(report, { ...view, points: [{ ...view.points[0], unit: 'percentage-points' }] })).toThrow('HISTORY_UNIT_MISMATCH');
    expect(() => withExternalRiskHistory(report, view, { construction, funding, scopeId: 'another' })).toThrow('HISTORY_SCOPE_MISMATCH');
  });
  it('keeps a pending current month unavailable when historical months have values', () => {
    const current = report.metrics.find(item => item.id === 'construction')!;
    const pending = { ...report, metrics: report.metrics.map(item => item.id === 'construction' ? { ...current, status: '산출 중', points: [] } : item) };
    const projected = withExternalRiskHistory(pending, view);
    expect(projected.metrics.find(item => item.id === 'construction')).toMatchObject({ status: '산출 중', narrative: '현재 산출 불가' });
    expect(projected.metrics.find(item => item.id === 'construction')?.points.at(-1)).toMatchObject({ kind: 'missing', value: null, reason: '현재 산출 불가' });
  });
  it('renders the existing Astryx report with three sheets, five charts and both 18-month axes', () => {
    const projected = withExternalRiskHistory(report, view);
    const html = renderToStaticMarkup(<FinancialReportPreview report={projected} />);
    expect(html.match(/aria-label="보고서 \d쪽"/g)).toHaveLength(3);
    expect(html.match(/<figure\b/g)).toHaveLength(5);
    expect(html).toContain('18개 기준월');
    expect(html).toContain('2025/02');
    expect(html).toContain('2025/04');
    expect(html).toContain('2026/07');
    expect(html).toContain('2026/08');
    expect(html).not.toContain('>2026/09</text>');
  });
});
