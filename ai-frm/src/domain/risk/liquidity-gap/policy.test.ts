import { describe, it, expect } from 'vitest';
import { LIQUIDITY_GAP_BANDS, commentFor } from '@/domain/risk/liquidity-gap/policy';
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

describe('유동성 Gap 등급별 코멘트', () => {
  it('네 등급 모두 문구가 있다', () => {
    for (const grade of ['정상', '주의', '경고', '위기'] as const) {
      expect(commentFor(grade)).toBeTruthy();
    }
  });
});
