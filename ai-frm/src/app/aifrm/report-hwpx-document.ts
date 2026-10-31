/** Immutable presentation of saved report strings; no financial calculation. */
import type { FinancialReport, ReportMetric } from './report-model';
export type ReportImageRole = 'recovery' | 'liquidity' | 'construction' | 'funding' | 'cash' | 'referenceRisk' | 'referenceLcr';
export type ReportHwpxAssets = Readonly<Record<ReportImageRole, Uint8Array>>;
export type ReportTone = 'ink' | 'blue' | 'crisis';
export type ReportTextStyle = 'title' | 'date' | 'body' | 'formula' | 'summary' | 'heading' | 'reference-header' | 'metric-body' | 'metric-note' | 'footer';
export type TextBlock = Readonly<{
    kind: 'text';
    text: string;
    style: ReportTextStyle;
}>;
export type ImageBlock = Readonly<{
    kind: 'image';
    role: ReportImageRole;
}>;
export type SummaryItem = Readonly<{
    label: string;
    status: string;
    tone: ReportTone;
}>;
export type SummaryBlock = Readonly<{
    kind: 'summary';
    items: readonly SummaryItem[];
}>;
export type MetricBlock = Readonly<{
    kind: 'metric';
    title: string;
    value: string;
    status: string;
    narrative: string;
    basis: string | null;
    formula: string;
    imageRole: ReportImageRole;
    tone: ReportTone;
}>;
export type ReportBlock = TextBlock | ImageBlock | SummaryBlock | MetricBlock;
export type PageSpec = Readonly<{
    blocks: readonly ReportBlock[];
}>;
export type ReportDocument = Readonly<{
    reportMonth: string;
    generatedOn: string;
    pages: readonly PageSpec[];
    styleProfile: 'report';
}>;
const IDS = ['recovery', 'liquidity', 'construction', 'funding', 'cash'] as const;
function tone(metric: ReportMetric): ReportTone {
    return metric.grade === '정상' ? 'blue' : metric.grade !== null || metric.status === '적정시재 부족' ? 'crisis' : 'ink';
}
function metricBlock(metric: ReportMetric): MetricBlock {
    const points = Array.from(metric.narrative);
    const narrative = (metric.status === '산출 불가' || metric.status === '산출 중') && points.length > 60
        ? points.slice(0, 59).join('') + '… (상세는 HTML 참고)' : metric.narrative;
    return Object.freeze({ kind: 'metric', title: metric.title, value: metric.value, status: metric.status,
        narrative, basis: metric.id === 'construction' ? metric.basis : null,
        formula: metric.formula, imageRole: metric.id, tone: tone(metric) });
}
const text = (text: string, style: ReportTextStyle): TextBlock => Object.freeze({ kind: 'text', text, style });
const page = (...blocks: ReportBlock[]): PageSpec => Object.freeze({ blocks: Object.freeze(blocks) });
export function projectReport(report: FinancialReport): ReportDocument {
    if (report.metrics.length !== 5 || new Set(report.metrics.map(m => m.id)).size !== 5 || IDS.some(id => !report.metrics.some(m => m.id === id))) {
        throw new Error('exactly five unique metric IDs are required');
    }
    const byId = (id: ReportMetric['id']) => metricBlock(report.metrics.find(m => m.id === id)!);
    const summary: SummaryBlock = Object.freeze({ kind: 'summary', items: Object.freeze(report.metrics.map(m => Object.freeze({ label: m.title, status: m.status, tone: tone(m) }))) });
    return Object.freeze({ reportMonth: report.reportMonth, generatedOn: report.generatedOn, styleProfile: 'report', pages: Object.freeze([
            page(text(report.title, 'title'), text(`(${report.generatedOn}, 자금기획팀)`, 'date'), text('□ 재무위험지수 종합', 'heading'), summary, text('□ 위험수준 측정결과', 'heading'), byId('recovery'), byId('liquidity')),
            page(byId('construction'), byId('funding'), text('□ 적정시재 산정결과', 'heading'), byId('cash')),
            page(text('참고', 'reference-header'), text('□ 위험단계 기준', 'heading'), Object.freeze({ kind: 'image', role: 'referenceRisk' }), text('□ 적정시재 산정방식 (LCR 방식)', 'heading'), Object.freeze({ kind: 'image', role: 'referenceLcr' })),
        ]) });
}
