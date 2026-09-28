import { describe, it, expect } from 'vitest';
import { defineBands, gradeBy } from '@/domain/risk/grade';
import { ratio } from '@/domain/shared/amount';

// 회의록 기준: 정상 0.5 이상 / 주의 0.25~0.5 / 경고 0.15~0.25 / 위기 0.15 미만
const BANDS = defineBands([
  { atLeast: 0.5, grade: '정상' },
  { atLeast: 0.25, grade: '주의' },
  { atLeast: 0.15, grade: '경고' },
  { atLeast: Number.NEGATIVE_INFINITY, grade: '위기' },
]);

describe('등급 판정', () => {
  it.each([
    [1.69, '정상'],
    [0.5, '정상'],
    [0.4999, '주의'],
    [0.25, '주의'],
    [0.2499, '경고'],
    [0.15, '경고'],
    [0.1499, '위기'],
    [0, '위기'],
    [-1, '위기'],
  ])('비율 %s → %s', (value, expected) => {
    expect(gradeBy(BANDS, ratio(value))).toBe(expected);
  });
});

describe('구간표 불변식', () => {
  it('내림차순이 아니면 거부한다', () => {
    expect(() =>
      defineBands([
        { atLeast: 0.15, grade: '경고' },
        { atLeast: 0.5, grade: '정상' },
        { atLeast: Number.NEGATIVE_INFINITY, grade: '위기' },
      ]),
    ).toThrow(/내림차순/);
  });

  it('전 구간을 덮지 않으면 거부한다 — 판정 불능이 생기면 안 된다', () => {
    expect(() =>
      defineBands([
        { atLeast: 0.5, grade: '정상' },
        { atLeast: 0.25, grade: '주의' },
      ]),
    ).toThrow(/전 구간/);
  });

  it('비어 있으면 거부한다', () => {
    expect(() => defineBands([])).toThrow();
  });
});

describe('구간표는 값의 종류를 가린다', () => {
  // 비율이 아닌 판정값(예: 건설경기 인식 지수의 0~100 지수)도 같은 도구로 판정한다.
  // 다만 비율 구간표에 다른 종류의 값을 넣으면 컴파일에서 막혀야 한다(D2).
  type Score100 = number & { readonly __kind: 'score100' };
  const score100 = (n: number) => n as Score100;

  const SCORE_BANDS = defineBands<Score100>([
    { atLeast: 60, grade: '위기' },
    { atLeast: 20, grade: '주의' },
    { atLeast: Number.NEGATIVE_INFINITY, grade: '정상' },
  ]);

  it('비율이 아닌 값도 그 종류의 구간표로 판정한다 — 경계는 위 구간에 넣는다', () => {
    expect(gradeBy(SCORE_BANDS, score100(20))).toBe('주의');
    expect(gradeBy(SCORE_BANDS, score100(19.99))).toBe('정상');
    expect(gradeBy(SCORE_BANDS, score100(100.47))).toBe('위기');
  });

  it('종류가 다른 값은 넣을 수 없다', () => {
    // @ts-expect-error 비율 구간표에 지수를 넣을 수 없다
    gradeBy(BANDS, score100(1));
    // @ts-expect-error 지수 구간표에 비율을 넣을 수 없다
    gradeBy(SCORE_BANDS, ratio(1));
  });
});
