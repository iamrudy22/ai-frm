import { describe, it, expect } from 'vitest';
import { LIQUIDITY_GAP_BANDS, PAYMENT_RECOVERY_BANDS, commentFor } from '@/domain/risk/policy';
import { gradeBy } from '@/domain/risk/grade';
import { ratio } from '@/domain/shared/amount';

// 정본: docs/meeting-notes/2026-09-09-daegeum-hoe-su-risk.md
describe('유동성 Gap 구간표', () => {
  it.each([
    [1.69, '정상'], // 회의록의 169% 사례
    [0.5, '정상'],
    [0.3, '주의'],
    [0.2, '경고'],
    [0.1, '위기'],
  ])('%s → %s', (v, expected) => {
    expect(gradeBy(LIQUIDITY_GAP_BANDS, ratio(v))).toBe(expected);
  });
});

describe('대금 회수 위험 구간표', () => {
  it.each([
    [1.02, '정상'], // 회의록의 102% 사례
    [0.9, '정상'],
    [0.85, '주의'],
    [0.75, '경고'],
    [0.6, '위기'],
  ])('%s → %s', (v, expected) => {
    expect(gradeBy(PAYMENT_RECOVERY_BANDS, ratio(v))).toBe(expected);
  });
});

describe('등급별 코멘트', () => {
  it('지표마다 문구가 다르다', () => {
    expect(commentFor('liquidity-gap', '위기')).not.toBe(commentFor('payment-recovery', '위기'));
  });

  it('네 등급 모두 문구가 있다', () => {
    for (const grade of ['정상', '주의', '경고', '위기'] as const) {
      expect(commentFor('liquidity-gap', grade)).toBeTruthy();
      expect(commentFor('payment-recovery', grade)).toBeTruthy();
    }
  });
});
