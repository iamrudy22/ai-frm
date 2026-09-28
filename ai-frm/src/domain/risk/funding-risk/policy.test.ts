import { describe, it, expect } from 'vitest';
import { gradeBy } from '@/domain/risk/grade';
import { commentFor, FUNDING_RISK_BANDS, OBSERVATION_LAG_MONTHS, spread } from '@/domain/risk/funding-risk/policy';

describe('조달위험 인식 지수 구간표', () => {
  it.each([
    [-0.05, '정상'],
    [0, '정상'],
    [0.239, '정상'],
    [0.24, '주의'],
    [0.281, '주의'],
    [0.519, '주의'],
    [0.52, '경고'],
    [0.789, '경고'],
    [0.79, '위기'],
    [1.5, '위기'],
  ] as const)('%s%%p → %s (경계값은 위 단계)', (value, expected) => {
    expect(gradeBy(FUNDING_RISK_BANDS, spread(value))).toBe(expected);
  });

  it('8월 판단은 7월 금리로 본다', () => {
    expect(OBSERVATION_LAG_MONTHS).toBe(1);
  });

  it('등급마다 코멘트가 있다', () => {
    for (const grade of ['정상', '주의', '경고', '위기'] as const) {
      expect(commentFor(grade)).not.toBe('');
    }
  });

  it('유한하지 않은 값은 금리 차이가 아니다', () => {
    expect(() => spread(Number.NaN)).toThrow();
  });
});
