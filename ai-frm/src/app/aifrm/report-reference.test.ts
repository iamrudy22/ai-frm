import { describe, expect, it } from 'vitest';
import {
  beyondPlanYearOf,
  calendarOf,
  createStatement,
  natureOf,
  unreadable,
  type StatementInput,
} from '@/domain/cashflow/statement';
import { amount, type Amount } from '@/domain/shared/amount';
import type { YearMonth } from '@/domain/shared/year-month';
import { buildStatementReferenceTrends, type ReferenceItem } from './report-reference';
import type { UploadedRound } from './uploaded-rounds';

const ITEMS: readonly ReferenceItem[] = ['분양회수', '수입', '지출', '기초시재'];

function uploaded(count = 22, base = 2, overrides: Partial<StatementInput['amounts']> = {}): UploadedRound {
  const series = (offset: number) => Array.from({ length: count }, (_, i) => amount(offset + i / 7));
  const statement = createStatement({
    asOf: new Date(2026, base, 10),
    // 일부러 반복·잘못된 연도 라벨을 사용한다. 달력 월은 라벨에서 파싱하지 않는다.
    monthLabels: Array.from({ length: count }, (_, i) => i < 12 ? `${i + 1}월` : `26.${i % 12 + 1}월`),
    baseMonthIndex: base,
    planYearEndIndex: Math.min(count - 1, 11),
    amounts: {
      분양회수: series(10), 수입: series(20), 지출: series(30), 기초시재: series(40),
      수입계: series(900), 기타수입: series(5), ...overrides,
    },
  });
  return { file: 'synthetic-reference.xlsx', round: calendarOf(statement, statement.defaultBaseMonth), role: '최신 회차', statement };
}

function reference(latest: UploadedRound) {
  const result = buildStatementReferenceTrends(latest);
  expect(result).not.toBeNull();
  return result!;
}

describe('최신 파일 월별 참고 금액의 표시 범위', () => {
  it('2026/03 회차의 22열에서 2026/01~2027/06을 표시하고 뒤 4개월을 생략한다', () => {
    const result = reference(uploaded());
    expect(result.window).toEqual({
      from: '2026/01', to: '2027/06', omittedBefore: null,
      omittedAfter: { from: '2027/07', to: '2027/10', count: 4 },
    });
    for (const chart of result.charts) {
      for (const series of chart.series) {
        expect(series.points).toHaveLength(18);
        expect(series.points.map((point) => point.month)).toContain('2026/03');
      }
    }
  });

  it.each([1, 12, 18])('18열 이하인 %i열 파일은 모든 월열을 보존한다', (count) => {
    const latest = uploaded(count, Math.min(count - 1, 2));
    const result = reference(latest);
    expect(result.window).toEqual({
      from: '2026/01', to: calendarOf(latest.statement, latest.statement.months[count - 1]),
      omittedBefore: null, omittedAfter: null,
    });
    expect(result.charts.flatMap((chart) => chart.series).map((series) => series.points.length)).toEqual([count, count, count, count]);
  });

  it('기준월이 뒤쪽이면 기준월까지 최근 18열을 우선하고 앞뒤 생략을 각각 남긴다', () => {
    const result = reference(uploaded(30, 20));
    expect(result.sourceRound).toBe('2027/09');
    expect(result.window).toEqual({
      from: '2026/04', to: '2027/09',
      omittedBefore: { from: '2026/01', to: '2026/03', count: 3 },
      omittedAfter: { from: '2027/10', to: '2028/06', count: 9 },
    });
  });

  it('기준월이 마지막 열이면 앞 4개월만 생략한다', () => {
    expect(reference(uploaded(22, 21)).window).toEqual({
      from: '2026/05', to: '2027/10',
      omittedBefore: { from: '2026/01', to: '2026/04', count: 4 }, omittedAfter: null,
    });
  });
});

describe('참고 금액의 값·성격·출처 보존', () => {
  it('세 차트의 운영 수입과 모든 점의 금액·달·성격·월 순번/라벨을 보존한다', () => {
    const latest = uploaded();
    const result = reference(latest);
    expect(result.sourceRound).toBe(latest.round);
    expect(result.sourceFile).toBe(latest.file);
    expect(result.unit).toBe('억원');
    expect(result.note).toBe('최신 회차에 기재된 월별 금액이며, 회차별 당시 위험지표 이력과 기준이 다릅니다.');
    expect(result.charts.map((chart) => [chart.id, chart.series.map((series) => series.item)])).toEqual([
      ['sales-recovery', ['분양회수']], ['income-expense', ['수입', '지출']], ['opening-cash', ['기초시재']],
    ]);
    for (const series of result.charts.flatMap((chart) => chart.series)) {
      for (const [i, point] of series.points.entries()) {
        const month = latest.statement.months[i];
        expect(point).toEqual({
          kind: 'available', value: latest.statement.amountOf(series.item, month),
          month: calendarOf(latest.statement, month), nature: natureOf(latest.statement, series.item, month),
          beyondPlanYear: beyondPlanYearOf(latest.statement, month),
          source: { file: latest.file, round: latest.round, item: series.item, statementMonthIndex: month.index, monthLabel: month.label },
        });
        // 브랜드 타입은 읽기 모델에서도 유지되어야 한다.
        const calendarMonth: YearMonth = point.month;
        expect(calendarMonth).toBe(calendarOf(latest.statement, month));
        if (point.kind === 'available') {
          const value: Amount = point.value;
          expect(value).toBe(latest.statement.amountOf(series.item, month));
        }
      }
    }
    const opening = result.charts[2].series[0].points;
    expect(opening[2].nature).toBe('opening-balance');
    expect(opening[3].nature).toBe('planned-opening-balance');
    expect(result.charts[0].series[0].points[2].nature).toBe('plan');
    expect(opening[12].month).toBe('2027/01');
    expect(opening[12].beyondPlanYear).toBe(true);
  });

  it('앞을 생략해도 source의 월 순번은 표시 순번으로 다시 매기지 않는다', () => {
    const latest = uploaded(22, 21);
    const first = reference(latest).charts[0].series[0].points[0];
    expect(first.source.statementMonthIndex).toBe(4);
    expect(first.source.monthLabel).toBe(latest.statement.months[4].label);
    expect(first.month).toBe('2026/05');
  });

  it('0·음수·소수 금액도 정상 값으로 그대로 보존한다', () => {
    const latest = uploaded(3, 2, { 수입: [amount(0), amount(-3.25), amount(1 / 7)] });
    expect(reference(latest).charts[1].series[0].points.map(({ kind, value }) => ({ kind, value }))).toEqual([
      { kind: 'available', value: 0 }, { kind: 'available', value: -3.25 }, { kind: 'available', value: 1 / 7 },
    ]);
  });

  it('지출 판독 실패는 해당 계열만 사유와 함께 missing으로 남긴다', () => {
    const latest = uploaded(3, 2, { 지출: unreadable('합성 지출의 빈 칸') });
    const result = reference(latest);
    for (const series of result.charts.flatMap((chart) => chart.series)) {
      for (const [i, point] of series.points.entries()) {
        expect(point.kind).toBe(series.item === '지출' ? 'missing' : 'available');
        if (series.item === '지출') {
          expect(point).toEqual({
            kind: 'missing', value: null, reason: '합성 지출의 빈 칸',
            month: calendarOf(latest.statement, latest.statement.months[i]),
            nature: natureOf(latest.statement, '지출', latest.statement.months[i]), beyondPlanYear: false,
            source: { file: latest.file, round: latest.round, item: '지출', statementMonthIndex: i, monthLabel: latest.statement.months[i].label },
          });
        }
      }
    }
  });

  it('모든 참고 항목이 실패해도 세 차트와 항목별 사유를 유지한다', () => {
    const latest = uploaded(3, 2, {
      분양회수: unreadable('합성 분양회수 실패'), 수입: unreadable('합성 수입 실패'),
      지출: unreadable('합성 지출 실패'), 기초시재: unreadable('합성 기초시재 실패'),
    });
    const result = reference(latest);
    expect(result.charts).toHaveLength(3);
    expect(result.charts.flatMap((chart) => chart.series).map((series) => series.item)).toEqual(ITEMS);
    for (const series of result.charts.flatMap((chart) => chart.series)) {
      expect(series.points).toHaveLength(3);
      for (const point of series.points) expect(point).toMatchObject({ kind: 'missing', value: null, reason: `합성 ${series.item} 실패` });
    }
  });

  it('입력과 원래 22개월 도메인 계열을 변경하지 않으며 재호출 결과도 같다', () => {
    const latest = uploaded();
    for (const month of latest.statement.months) Object.freeze(month);
    Object.freeze(latest.statement.months);
    Object.freeze(latest.statement);
    Object.freeze(latest);
    const before = latest.statement.months.map((month) => ({ ...month, value: latest.statement.amountOf('분양회수', month) }));
    const first = reference(latest);
    expect(reference(latest)).toEqual(first);
    expect(latest.statement.months.map((month) => ({ ...month, value: latest.statement.amountOf('분양회수', month) }))).toEqual(before);
    expect(latest.statement.months).toHaveLength(22);
  });

  it('같은 회차의 수정 파일 입력은 즉시 새 금액과 파일명을 반영한다', () => {
    const original = uploaded(3, 2);
    const revised = { ...uploaded(3, 2, { 수입: [amount(1), amount(2), amount(3)] }), file: 'synthetic-revised.xlsx' };
    expect(reference(original).sourceRound).toBe(reference(revised).sourceRound);
    const result = reference(revised);
    expect(result.sourceFile).toBe(revised.file);
    expect(result.charts[1].series[0].points.map(({ value }) => value)).toEqual([1, 2, 3]);
    expect(result.charts[1].series[0].points.every(({ source }) => source.file === revised.file)).toBe(true);
  });

  it('알 수 없는 구현 예외는 missing으로 바꾸지 않고 전달한다', () => {
    const latest = uploaded(3, 2);
    const failure = new Error('합성 구현 오류');
    const broken = { ...latest, statement: { ...latest.statement, amountOf: () => { throw failure; } } };
    expect(() => buildStatementReferenceTrends(broken)).toThrow(failure);
  });

  it('빈 양식(null 입력)에는 참고자료를 만들지 않는다', () => {
    expect(buildStatementReferenceTrends(null)).toBeNull();
  });
});
