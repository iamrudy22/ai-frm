import { describe, expect, it } from 'vitest';
import { yearMonth } from '@/domain/shared/year-month';
import {
  splitChartSegments,
  summarizeHistory,
  type ChartDatum,
  type ChartSegment,
} from './report-chart-view';

const available = (month: number, value = 1, planned = false): ChartDatum => ({
  month: yearMonth(2026, month), kind: 'available', value, planned,
});
const missing = (month: number): ChartDatum => ({
  month: yearMonth(2026, month), kind: 'missing', value: null, reason: '합성 자료 부족',
});
const notApplicable = (month: number): ChartDatum => ({
  month: yearMonth(2026, month), kind: 'not-applicable', value: null, reason: '합성 정상 순유입',
});

describe('위험 이력의 월별 확보 요약', () => {
  it('빈 축에는 양 끝과 확보 월이 없다', () => {
    expect(summarizeHistory([])).toEqual({
      from: null, to: null, totalMonths: 0, availableMonths: [], missingMonths: [],
      notApplicableMonths: [], kind: 'empty',
    });
  });

  it('값이 0인 한 달도 확보한 단일 값으로 센다', () => {
    expect(summarizeHistory([available(6, 0)])).toEqual({
      from: '2026/06', to: '2026/06', totalMonths: 1, availableMonths: ['2026/06'],
      missingMonths: [], notApplicableMonths: [], kind: 'single',
    });
  });

  it('최신 달이 결측이어도 과거 확보 값을 보존하고 축 끝은 최신 달이다', () => {
    expect(summarizeHistory([available(6), missing(7)])).toEqual({
      from: '2026/06', to: '2026/07', totalMonths: 2, availableMonths: ['2026/06'],
      missingMonths: ['2026/07'], notApplicableMonths: [], kind: 'single',
    });
  });

  it('비적용 한 달은 결측에 포함하지 않고 수치 확보는 빈 상태다', () => {
    expect(summarizeHistory([notApplicable(6)])).toEqual({
      from: '2026/06', to: '2026/06', totalMonths: 1, availableMonths: [],
      missingMonths: [], notApplicableMonths: ['2026/06'], kind: 'empty',
    });
  });

  it('결측과 비적용만 섞여도 각 상태의 월수를 분리한다', () => {
    expect(summarizeHistory([missing(6), notApplicable(7), missing(8)])).toEqual({
      from: '2026/06', to: '2026/08', totalMonths: 3, availableMonths: [],
      missingMonths: ['2026/06', '2026/08'], notApplicableMonths: ['2026/07'], kind: 'empty',
    });
  });

  it('모든 축 월은 세 상태 중 하나에만 속하며 0·음수는 수치 확보로 센다', () => {
    const result = summarizeHistory([
      available(5, 0), missing(6), notApplicable(7), available(8, -2),
    ]);
    expect(result).toEqual({
      from: '2026/05', to: '2026/08', totalMonths: 4,
      availableMonths: ['2026/05', '2026/08'], missingMonths: ['2026/06'],
      notApplicableMonths: ['2026/07'], kind: 'multiple',
    });
    const allMonths = [...result.availableMonths, ...result.missingMonths, ...result.notApplicableMonths];
    expect(allMonths).toHaveLength(result.totalMonths);
    expect(new Set(allMonths).size).toBe(result.totalMonths);
  });

  it.each([NaN, Infinity, -Infinity])('비유한 수치 %s는 결측으로 집계한다', (value) => {
    expect(summarizeHistory([available(6, value)])).toEqual({
      from: '2026/06', to: '2026/06', totalMonths: 1, availableMonths: [],
      missingMonths: ['2026/06'], notApplicableMonths: [], kind: 'empty',
    });
  });
});

describe('실적·계획의 인접 월 선 구간', () => {
  const cases: { name: string; points: readonly ChartDatum[]; expected: readonly ChartSegment[] }[] = [
    { name: '빈 축', points: [], expected: [] },
    { name: '실적 한 점', points: [available(6)], expected: [] },
    { name: '계획 한 점', points: [available(6, 1, true)], expected: [] },
    { name: '실적 사이 결측', points: [available(6), missing(7), available(8)], expected: [] },
    { name: '실적과 계획 접점', points: [available(6), available(7, 2, true)], expected: [{ planned: true, indices: [0, 1] }] },
    {
      name: '실적 두 점 뒤 계획 두 점',
      points: [available(6), available(7, 2), available(8, 3, true), available(9, 4, true)],
      expected: [{ planned: false, indices: [0, 1] }, { planned: true, indices: [1, 2, 3] }],
    },
    {
      name: '결측 뒤의 계획 두 점',
      points: [available(6), missing(7), available(8, 2, true), available(9, 3, true)],
      expected: [{ planned: true, indices: [2, 3] }],
    },
    {
      name: '실적·계획 접점 뒤 결측과 계획',
      points: [available(6), available(7, 2, true), missing(8), available(9, 3, true)],
      expected: [{ planned: true, indices: [0, 1] }],
    },
    {
      name: '계획에서 실적으로 돌아오는 접점',
      points: [available(6, 1, true), available(7), available(8)],
      expected: [{ planned: true, indices: [0, 1] }, { planned: false, indices: [1, 2] }],
    },
  ];
  it.each(cases)('$name: 정확한 선 인덱스를 반환한다', ({ points, expected }) => {
    expect(splitChartSegments(points)).toEqual(expected);
  });

  it.each([
    { name: '비적용', point: notApplicable(7) },
    { name: 'NaN', point: available(7, NaN) },
    { name: 'Infinity', point: available(7, Infinity) },
    { name: '-Infinity', point: available(7, -Infinity) },
  ])('$name: 선을 끊고 뒤쪽 유효 구간은 보존한다', ({ point }) => {
    expect(splitChartSegments([available(6), point, available(8), available(9)])).toEqual([
      { planned: false, indices: [2, 3] },
    ]);
  });

  it('6월 다음에 8월만 주어지면 누락된 7월을 건너 잇지 않는다', () => {
    expect(splitChartSegments([available(6), available(8), available(9)])).toEqual([
      { planned: false, indices: [1, 2] },
    ]);
  });

  it('12월과 다음 해 1월은 연속 월로 잇는다', () => {
    expect(splitChartSegments([
      available(12), { month: yearMonth(2027, 1), kind: 'available', value: 0 },
    ])).toEqual([{ planned: false, indices: [0, 1] }]);
  });

  it('0·음수는 유효한 선을 만들고 계획 전환 선분을 중복하지 않는다', () => {
    const points = [available(6, 0), available(7, -1), available(8, -2, true), available(9, 0, true)];
    const segments = splitChartSegments(points);
    expect(segments).toEqual([
      { planned: false, indices: [0, 1] }, { planned: true, indices: [1, 2, 3] },
    ]);
    const edges = segments.flatMap(({ indices }) => indices.slice(1).map((to, i) => `${indices[i]}:${to}`));
    expect(edges).toEqual(['0:1', '1:2', '2:3']);
    expect(new Set(edges).size).toBe(edges.length);
    expect(points.map(({ value }) => value)).toEqual([0, -1, -2, 0]);
  });

  it('같은 선 스타일이어도 결측 전후의 구간은 합치지 않는다', () => {
    expect(splitChartSegments([available(5), available(6), missing(7), available(8), available(9)])).toEqual([
      { planned: false, indices: [0, 1] }, { planned: false, indices: [3, 4] },
    ]);
  });

  it('동결한 입력을 변경하지 않고 재호출 결과도 같다', () => {
    const points = Object.freeze([
      Object.freeze(available(6)), Object.freeze(available(7, 2, true)), Object.freeze(missing(8)),
    ]);
    const expectedCoverage = {
      from: '2026/06', to: '2026/08', totalMonths: 3, availableMonths: ['2026/06', '2026/07'],
      missingMonths: ['2026/08'], notApplicableMonths: [], kind: 'multiple',
    };
    expect(summarizeHistory(points)).toEqual(expectedCoverage);
    expect(summarizeHistory(points)).toEqual(expectedCoverage);
    expect(splitChartSegments(points)).toEqual([{ planned: true, indices: [0, 1] }]);
    expect(splitChartSegments(points)).toEqual([{ planned: true, indices: [0, 1] }]);
    expect(points).toEqual([available(6), available(7, 2, true), missing(8)]);
  });
});
