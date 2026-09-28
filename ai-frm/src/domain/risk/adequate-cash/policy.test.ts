import { describe, it, expect } from 'vitest';
import { LCR_WEIGHTS, verdictLabel } from '@/domain/risk/adequate-cash/policy';

// 정본: 2026-09-28 정책 확정 (docs/plans/2026-09-28-jeokjeong-sijae-prd.md §4-1)
describe('적정 시재 LCR 가중치', () => {
  it('분양회수 20% · 기타수입 10% · 지출 10% · 수지차 40%', () => {
    expect(LCR_WEIGHTS).toEqual({ 분양회수: 0.2, 기타수입: 0.1, 지출: 0.1, 수지차: 0.4 });
  });

  it('자금조달에는 가중치가 없다 — 산식에서 제외한다', () => {
    expect(Object.keys(LCR_WEIGHTS)).not.toContain('자금조달');
  });
});

// 적정 시재에는 등급이 없다. T/F와 두 표기뿐이다 (PRD §9-6).
describe('적정 시재 판정 표기', () => {
  it('T는 안정적', () => {
    expect(verdictLabel(true)).toBe('안정적');
  });

  it('F는 적정시재 부족', () => {
    expect(verdictLabel(false)).toBe('적정시재 부족');
  });
});
