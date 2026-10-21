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

function statusText(html: string, label: string): string | undefined {
  return html.match(new RegExp(`<[^>]+role="status"[^>]*aria-label="${label}"[^>]*>([^<]*)</[^>]+>`))?.[1];
}

function visibleText(html: string): string {
  return html.replace(/<svg\b[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
}

describe('보고서 작업 영역과 출력 상태', () => {
  it('산출 전 모델은 완료된 보고서로 표시하지 않는다', () => {
    expect(statusText(markup(buildFinancialReport()), '지표 산출 상태')).toBe('산출 전');
  });

  it('현재 보고서의 산출 중·산출 불가 개수를 알려 완료 결과와 구별한다', () => {
    const value = report();
    const html = markup({ ...value, metrics: value.metrics.map((metric, index) => ({
      ...metric, status: index < 2 ? '산출 중' : index === 2 ? '산출 불가' : '정상',
    })) });
    expect(statusText(html, '지표 산출 상태')).toBe('산출 중 2개 · 산출 불가 1개');
    expect(html).not.toContain('현재 상태와 사유를 포함해 출력합니다.');
    expect(html).not.toContain('지표 5개 산출 완료');
  });

  it('조회 중이거나 산출 불가인 지표가 없으면 전체 지표의 산출 완료를 알린다', () => {
    const value = report();
    const html = markup({ ...value, metrics: value.metrics.map((metric) => ({ ...metric, status: '정상' })) });
    expect(statusText(html, '지표 산출 상태')).toBe('지표 5개 산출 완료');
  });

  it('월별 참고자료가 모델에 있어도 HTML과 PDF는 골든셋의 세 쪽만 제공한다', () => {
    expect(report().referenceTrends).not.toBeNull();
    const html = markup();
    expect(html.match(/aria-label="보고서 \d쪽"/g)).toHaveLength(3);
    expect(statusText(html, 'PDF 출력 구성')).toBe('PDF 출력: 3쪽');
    expect(page(html, 3)).toContain('report-sheet-last');
    expect(html).not.toContain('월별 금액 참고자료를 PDF에 포함');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('data-include-reference-in-print');
    expect(html).not.toContain('report-reference-sheet');
    expect(html).not.toContain('최신 파일의 월별 금액 참고자료');
    expect(html.match(/<figure/g)).toHaveLength(5);
    expect(html).not.toContain('인쇄 창에서');
  });

  it('복귀 동작을 제공하면 보고서 안에 복귀 버튼과 인쇄·PDF 저장 버튼을 함께 제공한다', () => {
    const html = renderToStaticMarkup(<FinancialReportPreview report={report()} onBack={() => {}} />);
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(buttons.filter((button) => button.includes('대시보드로 돌아가기'))).toHaveLength(1);
    expect(buttons.filter((button) => button.includes('인쇄 / PDF 저장'))).toHaveLength(1);
    expect(html).toMatch(/<h2\b[^>]*id="report-view-heading"[^>]*tabindex="-1"/);
    expect(markup()).not.toContain('대시보드로 돌아가기');
  });
});

describe('골든셋에 맞춘 보고서 본문', () => {
  it('본문의 주값·등급·해석·산식은 모델 그대로 표시하고 부가 메타데이터는 생략한다', () => {
    const value = report();
    const html = markup({ ...value, warnings: ['합성 부가 경고'], metrics: value.metrics.map((item) => ({
      ...item, status: '정상', grade: '정상', narrative: `${item.title} 해석 유지`,
      value: item.id === 'recovery' ? '1.00' : item.id === 'liquidity' ? '1.69' : item.value,
      source: '합성 원천 자료명', basis: `${item.id} 합성 기준`,
    })) });
    const body = visibleText(html);
    expect(page(html, 1)).toContain('>1.00<');
    expect(page(html, 1)).toContain('>1.69<');
    expect(page(html, 1)).not.toContain('1.00 배');
    expect(page(html, 1)).not.toContain('1.69 배');
    expect(body).toContain('재무위험지수 종합');
    expect(body).toContain('위험수준 측정결과');
    expect(body).toContain('적정시재 산정결과');
    for (const metric of value.metrics) {
      expect(body).toContain(`${metric.title} 해석 유지`);
      expect(body).toContain(metric.formula);
      expect(body).not.toContain(`자료: ${metric.source}`);
    }
    expect(body).toContain('기준: construction 합성 기준');
    for (const id of ['recovery', 'liquidity', 'funding', 'cash']) expect(body).not.toContain(`${id} 합성 기준`);
    expect(body).not.toContain('합성 원천 자료명');
    expect(body).not.toContain('합성 부가 경고');
    expect(body).not.toContain('보고 기준:');
    expect(body).not.toContain('최신 회차:');
    expect(body).not.toContain('자료 상태:');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('<figcaption');
  });

  it('참고 표는 골든셋 원본 이미지로 보존하며 세 쪽 구성을 유지한다', () => {
    const html = markup(buildFinancialReport());
    expect(html.match(/aria-label="보고서 \d쪽"/g)).toHaveLength(3);
    expect(html).not.toContain('양식 미리보기:');
    const reference = visibleText(page(html, 3));
    expect(reference).toContain('위험단계 기준');
    expect(reference).toContain('적정시재 산정방식 (LCR 방식)');
    const images = page(html, 3).match(/<img\b[^>]*>/g) ?? [];
    expect(images).toHaveLength(2);
    expect(images[0]).toContain('reference-risk-criteria.png');
    expect(images[0]).toContain('alt="골든셋 원본 위험단계 기준표: 내부·외부 관리지표와 산식, 구성 가중치, 정상·주의·경고·위기 기준"');
    expect(images[1]).toContain('reference-lcr-formula.png');
    expect(images[1]).toContain('alt="골든셋 원본 적정시재 산정방식(LCR 방식) 표"');
    for (const image of images) {
      expect(image).toContain('loading="eager"');
      expect(image).toContain('h-auto w-full');
    }
    const descriptions = images.map((image, index) => {
      const id = index === 0 ? 'reference-risk-criteria-description' : 'reference-lcr-formula-description';
      expect(image).toContain(`aria-describedby="${id}"`);
      const element = page(html, 3).match(new RegExp(`<div\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)</div>`))?.[0] ?? '';
      expect(element).not.toBe('');
      expect(element).not.toContain('aria-hidden="true"');
      return visibleText(element).replace(/\s+/g, ' ').trim();
    });
    for (const row of [
      '정상(G) 90%이상, 주의(Y) 90%미만 80%이상, 경고(O) 80%미만 70%이상, 위기(R) 70%미만',
      '정상(G) 50%이상, 주의(Y) 50%미만 25%이상, 경고(O) 25%미만 15%이상, 위기(R) 15%미만',
      '정상(G) 20미만, 주의(Y) 20이상 40미만, 경고(O) 40이상 60미만, 위기(R) 60이상',
      '정상(G) 0.24%미만, 주의(Y) 0.24%이상 0.52%미만, 경고(O) 0.52%이상 0.79%미만, 위기(R) 0.79%이상',
    ]) expect(descriptions[0]).toContain(row);
    for (const component of [
      '국내건설수주액(11)', '주택매매가격지수(23)', '미분양주택현황(4)', '주택건설인허가실적(31)', '설비투자지수(14)',
      '직전3개월 분양회수예측오차(3)', '대출금리(2)', 'KOSPI지수(5)', '원/달러환율(5)', '선행지수순환변동치(3)',
    ]) expect(descriptions[0]).toContain(component);
    expect(descriptions[0]).toContain('※ ( ) 괄호 안 : 가중치');
    expect(descriptions[1]).toBe('적정시재 = (향후 3개월) 분양회수예정액 X 20% + 기타회수예정액 X 10% + 사업비지출계획 X 10% + 순지출계획 X 40%');
    expect(page(html, 3)).not.toContain('<table');
    expect(reference).not.toContain('건설경기 인식 지수 구성');
    for (const addition of ['경계값은', '가중치는 소수점', '가중치 합계:', '기준 출처:', '각 항목은 3개월 합계', '발표 시차']) {
      expect(reference).not.toContain(addition);
    }
  });

  it('부족한 자료와 긴 판독 오류도 산출 불가 상태·해석을 유지하며 정상이나 0으로 대신하지 않는다', () => {
    const value = report({ file: fullFile, missing: ['분양회수', '지출', '기초시재'] });
    const target = value.metrics.find((metric) => metric.id === 'liquidity')!;
    const html = markup({ ...value, metrics: value.metrics.map((metric) => metric.id === 'liquidity'
      ? { ...metric, value: '—', status: '산출 불가', grade: null, narrative: fullReason } : metric) });
    const section = html.match(new RegExp(`<section[^>]*aria-label="${target.title}"[^>]*>[\\s\\S]*?</section>`))?.[0] ?? '';
    expect(section).toContain('[산출 불가]');
    expect(section).toContain(fullReason);
    expect(section).toContain('>—<');
    expect(section).not.toContain('[정상]');
    expect(section).not.toContain('>0<');
    expect(section).not.toContain('<details');
    const summary = section.match(/class="[^"]*report-print-summary[^"]*"[^>]*>([^<]*)/)?.[1] ?? '';
    expect([...summary].length).toBeLessThanOrEqual(90);
    expect(summary).toContain('판독 실패');
    expect(summary).not.toContain('\uFFFD');
    expect(visibleText(html)).not.toContain(fullFile);
  });

  it('이력의 상세 설명을 생략해도 현재 로딩·실패와 차트의 결측·0 값은 보존한다', () => {
    const value = report();
    const points: ReportPoint[] = [
      { month: ym('2026/05'), kind: 'available', value: 0 },
      { month: ym('2026/06'), kind: 'not-applicable', value: null, reason: '정상 순유입으로 비율을 적용하지 않습니다.' },
      { month: ym('2026/07'), kind: 'missing', value: null, reason: fullReason },
    ];
    const html = markup({ ...value, metrics: value.metrics.map((metric) => metric.id === 'liquidity' ? {
      ...metric, value: '—', status: '산출 불가', grade: null, narrative: fullReason, points, historyCoverage: summarizeHistory(points),
    } : metric) });
    expect(html).toContain('[산출 중]');
    expect(html).toContain('[산출 불가]');
    expect(html).toContain(fullReason);
    expect(html).toContain('2026/05 유동성 Gap: 0 배');
    const liquiditySection = html.match(/<section[^>]*aria-label="유동성 Gap"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(liquiditySection).not.toContain('<polyline');
    const body = visibleText(html);
    for (const addition of ['자료 상태:', '이력의 결측', '추가 사유', '과거 산출 이력 미조회', '회차 기준월의 당시 계획']) {
      expect(body).not.toContain(addition);
    }
  });

  it('정상 차트와 빈 차트 모두 시각적 주석만 생략하고 SVG 접근성 설명은 유지한다', () => {
    const metric = metricWithPoints('funding', [{ month: ym('2026/08'), kind: 'available', value: 0.239 }]);
    const html = renderToStaticMarkup(<ReportChart metric={metric} />);
    expect(html).not.toContain('<figcaption');
    expect(html).toContain('<title>조달위험 인식 지수 추이 (단위: %p)</title>');
    expect(html).toContain(`<desc>${metric.historyNote} 결측과 비적용 월은 연결하지 않습니다.</desc>`);
    expect(html).toContain('aria-label="조달위험 인식 지수 추이. 단위 %p. 1개 기준월.');
    const empty = renderToStaticMarkup(<ReportChart metric={{ ...metric, points: [], historyCoverage: summarizeHistory([]) }} />);
    expect(empty).not.toContain('<figcaption');
    expect(empty).toContain(metric.narrative);
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
