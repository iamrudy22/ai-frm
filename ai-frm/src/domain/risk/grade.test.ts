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
