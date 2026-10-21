import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { assessDashboard } from '@/application/dashboard';
import { createStatement, unreadable, type ItemName } from '@/domain/cashflow/statement';
import { amount } from '@/domain/shared/amount';
import { parseYearMonth as ym } from '@/domain/shared/year-month';
import { summarizeHistory } from './report-chart-view';
import { buildFinancialReport, type FinancialReport, type ReportPoint } from './report-model';
import { FinancialReportPreview } from './report-preview';
import { arrangeRounds } from './uploaded-rounds';

// 합성 자료만 사용한다. 이 테스트는 실제 Astryx·SVG를 SSR로 렌더링한다.
const fullFile = `${'합성🧪파일'.repeat(39)}.xlsx`;
const fullReason = Array.from(`판독 실패 🧪 ${'월별 금액 셀을 확인할 수 없습니다. '.repeat(30)}`).slice(0, 500).join('');

function report(options: { base?: number; missing?: readonly ItemName[]; file?: string } = {}): FinancialReport {
  const base = options.base ?? 7;
  const values = Array.from({ length: 22 }, (_, index) => amount(index === 0 ? 0 : -index * 10));
  const series = (item: ItemName) => options.missing?.includes(item) ? unreadable(fullReason) : values;
  const statement = createStatement({
    asOf: new Date(2026, base, 10),
    monthLabels: Array.from({ length: 22 }, (_, index) => index < 12 ? `${index + 1}월` : `다음해 ${index - 11}월`),
    baseMonthIndex: base,
    planYearEndIndex: 11,
    amounts: { 기초시재: series('기초시재'), 수입계: series('수입계'), 수입: series('수입'), 분양회수: series('분양회수'), 기타수입: series('기타수입'), 지출: series('지출') },
  });
  const arranged = arrangeRounds([{ file: options.file ?? 'synthetic.xlsx', statement }]);
  if (!arranged.ok) throw new Error(arranged.reason);
  return buildFinancialReport({
    rounds: arranged.rounds,
    dashboard: assessDashboard(null, statement, statement.defaultBaseMonth),
    gapMonth: arranged.latest.round, perception: null, funding: null,
    generatedAt: new Date('2026-10-20T15:30:00Z'),
  });
}

function markup(value = report()): string {
  return renderToStaticMarkup(<FinancialReportPreview report={value} />);
}

function page(html: string, number: number): string {
  return html.match(new RegExp(`<section[^>]*aria-label="보고서 ${number}쪽"[^>]*>[\\s\\S]*?(?=<section[^>]*aria-label="보고서 [1-4]쪽"|</article>)`))?.[0] ?? '';
}

describe('HTML 보고서와 PDF 참고자료 선택', () => {
  it('빈 양식은 3쪽만 제공하며 참고자료와 인쇄 선택을 생략한다', () => {
    const html = markup(buildFinancialReport());
    expect(html.match(/aria-label="보고서 \d쪽"/g)).toHaveLength(3);
    expect(html).not.toContain('월별 금액 참고자료를 PDF에 포함');
    expect(html).not.toContain('report-reference-sheet');
    expect(page(html, 3)).toContain('report-sheet-last');
  });

  it('파일 하나로 HTML 4쪽과 참고 차트 3개를 보이고 PDF 포함은 해제 상태로 시작한다', () => {
    const html = markup();
    expect(html.match(/aria-label="보고서 \d쪽"/g)).toHaveLength(4);
    expect(html).toContain('data-include-reference-in-print="false"');
    const input = html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
    expect(input).toBeDefined();
    expect(input).not.toContain('checked=""');
    expect(html).toContain('월별 금액 참고자료를 PDF에 포함');
    expect(page(html, 3)).toContain('report-sheet-last');
    expect(page(html, 4)).toContain('report-sheet-last');
    expect(page(html, 4).match(/<figure/g)).toHaveLength(3);
    expect(page(html, 4)).toContain('분양회수 월별 금액');
    expect(page(html, 4)).toContain('수입·지출 월별 금액');
    expect(page(html, 4)).toContain('기초시재 월별 금액');
  });

  it('참고 차트의 SVG 제목에 지표명과 단위를 하나의 텍스트로 전달한다', () => {
    expect(page(markup(), 4)).toContain('<title>분양회수 월별 금액 (단위: 억원)</title>');
  });

  it('전체 파일명과 오류는 HTML에 남기고 인쇄용 출처·사유는 유니코드를 보존하며 제한 길이로 축약한다', () => {
    const html = markup(report({ file: fullFile, missing: ['분양회수'] }));
    const reference = page(html, 4);
    expect(reference).toContain(fullFile);
    expect(reference).toContain(fullReason);
    const printSource = reference.match(/class="[^"]*report-print-source[^"]*"[^>]*>출처: (.*?) · /)?.[1] ?? '';
    const printReason = reference.match(/class="[^"]*report-print-reason[^"]*"[^>]*>분양회수 결측: (.*?) \(상세는 HTML 참고\)/)?.[1] ?? '';
    expect([...printSource]).toHaveLength(48);
    expect(printSource.endsWith('…')).toBe(true);
    expect([...printReason]).toHaveLength(60);
    expect(printReason.endsWith('…')).toBe(true);
    expect(reference).toContain('상세는 HTML 참고');
    expect(printSource).not.toContain('\uFFFD');
    expect(printReason).not.toContain('\uFFFD');
    expect(reference).toContain('report-screen-details');
    expect(reference).toContain('report-print-summary');
  });

  it('표시 창과 생략 범위, 실적·계획·계획연도 이후를 설명하고 실제 0·음수를 유지한다', () => {
    const html = page(markup(report({ base: 0 })), 4);
    expect(html).toContain('2026/01~2027/06');
    expect(html).toContain('뒤 생략: 2027/07~2027/10 (4개월)');
    expect(html).toContain('실적 실선 · 계획 점선');
    expect(html).toContain('계획 이월 잔고');
    expect(html).toContain('다음 해 미확정 계획 포함');
    expect(html).toContain('2026/01 분양회수: 0 억원 (계획)');
    expect(html).toContain('2026/02 분양회수: -10 억원 (계획)');
    expect(page(markup(report({ base: 19 })), 4)).toContain('앞 생략: 2026/01~2026/02 (2개월)');
  });

  it.each([{ label: '한 항목', missing: ['분양회수'] as const }, { label: '전체 항목', missing: ['분양회수', '수입', '지출', '기초시재'] as const }])('$label 판독 실패에도 4쪽과 출처·결측 사유를 유지한다', ({ missing }) => {
    const html = page(markup(report({ missing })), 4);
    expect(html.match(/<figure/g)).toHaveLength(3);
    expect(html).toContain('synthetic.xlsx');
    expect(html).toContain(fullReason);
    expect(html).toContain('결측 18개월');
    expect(html).toContain('2026/08 회차');
    expect(html).toContain('단위: 억원');
  });

  it('현재 로딩·실패를 과거 확보 안내로 덮지 않고 비적용과 결측을 나누어 표시한다', () => {
    const value = report();
    const points: ReportPoint[] = [
      { month: ym('2026/05'), kind: 'available', value: 0 },
      { month: ym('2026/06'), kind: 'not-applicable', value: null, reason: '정상 순유입으로 비율을 적용하지 않습니다.' },
      { month: ym('2026/07'), kind: 'missing', value: null, reason: fullReason },
    ];
    const metrics = value.metrics.map((metric) => metric.id === 'liquidity' ? {
      ...metric, status: '산출 불가', grade: null, narrative: fullReason, points, historyCoverage: summarizeHistory(points),
    } : metric);
    const html = markup({ ...value, metrics });
    expect(html).toContain('[산출 중]');
    expect(html).toContain('[산출 불가]');
    expect(html).toContain('2026/05의 1개월 값 확보');
    expect(html).toContain('비율 비적용 1개월');
    expect(html).toContain('결측 1개월');
    expect(html).toContain(fullReason);
    expect(html).not.toContain('자료 없음');
  });
});
