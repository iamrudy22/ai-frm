import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { assessDashboard } from '@/application/dashboard';
import { createStatement, unreadable, type ItemName } from '@/domain/cashflow/statement';
import { amount } from '@/domain/shared/amount';
import { addMonths, parseYearMonth as ym } from '@/domain/shared/year-month';
import { ReportChart } from './report-chart';
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

function svgTexts(html: string) {
  return [...html.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((match) => {
    const attribute = (name: string) => match[1].match(new RegExp(`(?:^| )${name}="([^"]*)"`))?.[1];
    return { text: match[2], x: Number(attribute('x')), y: Number(attribute('y')),
      anchor: attribute('text-anchor'), value: attribute('font-weight') !== undefined };
  });
}

function metricWithPoints(id: FinancialReport['metrics'][number]['id'], points: ReportPoint[]) {
  const metric = report().metrics.find((item) => item.id === id)!;
  return { ...metric, points, historyCoverage: summarizeHistory(points) };
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

  it.each(['liquidity', 'cash'] as const)('최신 %s가 정상이어도 18개월의 서로 다른 긴 사유를 인쇄 요약 두 줄로 제한하고 HTML 전문을 보존한다', (id) => {
    const reasons = Array.from({ length: 17 }, (_, index) => `${index + 1}번째 합성 사유 ${'서로 다른 월별 판독 오류 '.repeat(40)}`.slice(0, 500));
    const points: ReportPoint[] = reasons.map((reason, index) => ({ month: addMonths(ym('2025/01'), index),
      kind: index === 0 ? 'not-applicable' : 'missing', value: null, reason }));
    points.push({ month: ym('2026/06'), kind: 'available', value: 1, secondary: 2 });
    const value = report();
    const target = { ...metricWithPoints(id, points), status: '정상', grade: '정상' as const };
    const html = markup({ ...value, metrics: value.metrics.map((metric) => metric.id === id ? target : metric) });
    const section = html.match(new RegExp(`<section[^>]*aria-label="${target.title}"[^>]*>[\\s\\S]*?</section>`))?.[0] ?? '';
    const summaries = [...section.matchAll(/<[^>]+class="[^"]*report-print-summary[^"]*"[^>]*>([^<]*)<\/[^>]+>/g)].map((match) => match[1]);
    expect(summaries).toHaveLength(2);
    expect(summaries[1]).toContain('추가 사유 16종');
    expect(summaries[1]).toContain('상세는 HTML 참고');
    expect(summaries[1].match(/상세는 HTML 참고/g)).toHaveLength(1);
    expect([...summaries[1]].length).toBeLessThanOrEqual(100);
    for (const reason of reasons) expect(section).toContain(reason);
    expect(section).toContain('비율 비적용 1개월');
    expect(section).toContain('결측 16개월');
    expect(section).toContain('2026/06의 1개월 값 확보');
  });

  it('월초 잔고의 과거·기준월·미래 상태를 HTML 상세에서 구별한다', () => {
    const html = page(markup(), 4);
    expect(html).toMatch(/2026\/07 · 기초시재 · 월 순번 7 \(7월\) · 월초 잔고/);
    expect(html).toMatch(/2026\/08 · 기초시재 · 월 순번 8 \(8월\) · 기준월 월초 잔고/);
    expect(html).toMatch(/2026\/09 · 기초시재 · 월 순번 9 \(9월\) · 계획 이월 잔고/);
    expect(html).not.toMatch(/2026\/07 · 기초시재[^<]*기준월/);
  });
});

describe('인쇄 차트 라벨의 값·정밀도·배치', () => {
  it.each([14, 18])('%i개월 축의 끝 월을 보존하면서 인접 라벨 사이에 여백을 둔다', (count) => {
    const points: ReportPoint[] = Array.from({ length: count }, (_, index) => ({
      month: addMonths(ym('2025/01'), index), kind: 'available', value: 0.239,
    }));
    const html = renderToStaticMarkup(<ReportChart metric={metricWithPoints('funding', points)} />);
    const months = svgTexts(html).filter((text) => /^\d{4}\/\d{2}$/.test(text.text));
    expect(months[0].text).toBe('2025/01');
    expect(months.at(-1)?.text).toBe(count === 14 ? '2026/02' : '2026/06');
    // 12px SVG 글꼴에서 숫자·슬래시 7자의 폭을 보수적으로 49로 잡는다.
    const bounds = months.map((text) => ({ left: text.x - (text.anchor === 'end' ? 49 : text.anchor === 'middle' ? 24.5 : 0),
      right: text.x + (text.anchor === 'start' ? 49 : text.anchor === 'middle' ? 24.5 : 0) }));
    for (let index = 1; index < bounds.length; index++) expect(bounds[index].left - bounds[index - 1].right).toBeGreaterThanOrEqual(8);
    expect(bounds[0].left).toBeGreaterThanOrEqual(0);
    expect(bounds.at(-1)!.right).toBeLessThanOrEqual(660);
  });

  it.each([2, 14, 18])('%i개월의 긴 양 끝 값과 바닥 근처 두 계열 값을 축·서로 사이에 겹치지 않게 둔다', (count) => {
    const points: ReportPoint[] = Array.from({ length: count }, (_, index) => ({
      month: addMonths(ym('2025/01'), index), kind: 'available',
      value: index === 0 ? 12345678 : 1, secondary: index === 0 ? 12345677 : 0,
    }));
    const html = renderToStaticMarkup(<ReportChart metric={metricWithPoints('cash', points)} />);
    const labels = svgTexts(html).filter((text) => text.value);
    expect(labels.length).toBeGreaterThanOrEqual(2);
    for (const label of labels) {
      const width = label.text.length * 7;
      const left = label.x - (label.anchor === 'end' ? width : label.anchor === 'middle' ? width / 2 : 0);
      const right = label.x + (label.anchor === 'start' ? width : label.anchor === 'middle' ? width / 2 : 0);
      expect(left).toBeGreaterThanOrEqual(76);
      expect(right).toBeLessThanOrEqual(628);
      expect(label.y).toBeGreaterThanOrEqual(32);
      expect(label.y).toBeLessThanOrEqual(112);
    }
    for (const label of labels) {
      for (const other of labels.filter((candidate) => candidate !== label && candidate.x === label.x)) {
        expect(Math.abs(label.y - other.y)).toBeGreaterThanOrEqual(16);
      }
    }
    expect(html).toContain('현재시재');
    expect(html).toContain('적정시재');
    expect(html.match(/<polyline/g)).toHaveLength(2);
    expect(html).toContain('2025/01 현재시재: 12,345,678 억원');
    expect(html).toContain('적정시재: 0 억원');
  });

  it.each([
    { primary: 97, secondary: 117 },
    { primary: 117, secondary: 97 },
    { primary: 116, secondary: 117 },
    { primary: 117, secondary: 116 },
    { primary: 117, secondary: 117 },
    { primary: 0, secondary: 0 },
    { primary: 0, secondary: 1 },
    { primary: 1, secondary: 0 },
  ])('근접한 두 계열 ($primary, $secondary) 라벨은 실제 점의 수직순서·색상·축 안쪽을 유지한다', ({ primary, secondary }) => {
    const points: ReportPoint[] = [
      { month: ym('2026/07'), kind: 'available', value: 120, secondary: 120 },
      { month: ym('2026/08'), kind: 'available', value: primary, secondary },
    ];
    const html = renderToStaticMarkup(<ReportChart metric={metricWithPoints('cash', points)} />);
    const series = [...html.matchAll(/<g data-series="([^"]+)">([\s\S]*?)(?=<g data-series=|<\/svg>)/g)].map((match) => {
      const lastCircle = [...match[2].matchAll(/<circle\b[^>]*cy="([^"]+)"[^>]*fill="([^"]+)"/g)].at(-1)!;
      const label = svgTexts(match[2]).filter((text) => text.value).at(-1)!;
      const labelColor = [...match[2].matchAll(/<text\b[^>]*fill="([^"]+)"[^>]*font-weight="\d+"/g)].at(-1)?.[1];
      expect.soft(labelColor).toBe(lastCircle[2]);
      expect(label.y).toBeGreaterThanOrEqual(32);
      expect(label.y).toBeLessThanOrEqual(112);
      return { name: match[1], circleY: Number(lastCircle[1]), label };
    });
    expect(series.map((item) => item.name)).toEqual(['현재시재', '적정시재']);
    expect(series.map((item) => item.label.text)).toEqual([String(primary), String(secondary)]);
    const [current, adequate] = series;
    const labelsTopToBottom = current.circleY <= adequate.circleY
      ? [current.label, adequate.label] : [adequate.label, current.label];
    expect(labelsTopToBottom[1].y - labelsTopToBottom[0].y).toBeGreaterThanOrEqual(16);
  });

  it.each([
    { id: 'funding' as const, value: 0.239, want: '0.239', unit: '%p' },
    { id: 'recovery' as const, value: 0.239, want: '0.24', unit: '배' },
    { id: 'construction' as const, value: 20.239, want: '20.24', unit: '지수' },
    { id: 'cash' as const, value: 1234.239, want: '1,234', unit: '억원' },
  ])('표시 단위 $unit과 정밀도를 유지한다 ($want)', ({ id, value, want, unit }) => {
    const points: ReportPoint[] = [{ month: ym('2026/08'), kind: 'available', value, secondary: value + 1 }];
    const html = renderToStaticMarkup(<ReportChart metric={metricWithPoints(id, points)} />);
    expect(svgTexts(html).filter((text) => text.value).map((text) => text.text)).toContain(want);
    expect(html).toContain(`: ${want} ${unit}`);
  });
});
