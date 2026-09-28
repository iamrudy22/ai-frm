import { describe, it, expect } from 'vitest';
import { amount, ratio, divide, sumOf, minus, scale, toPercent } from '@/domain/shared/amount';

describe('금액과 비율', () => {
  it('금액을 나누면 비율이 된다', () => {
    expect(divide(amount(1690), amount(1000))).toBeCloseTo(1.69, 10);
  });

  it('금액을 합산한다', () => {
    expect(sumOf([amount(700), amount(300), amount(1)])).toBe(1001);
  });

  it('금액을 뺀다 — 음수도 금액이다', () => {
    expect(minus(amount(700), amount(1700))).toBe(-1000);
  });

  it('비율을 퍼센트로 표시한다', () => {
    expect(toPercent(ratio(1.69))).toBeCloseTo(169, 10);
  });

  it('유한하지 않은 값은 금액이 아니다', () => {
    expect(() => amount(Number.NaN)).toThrow();
    expect(() => amount(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('0으로 나누지 않는다', () => {
    expect(() => divide(amount(100), amount(0))).toThrow();
  });

  it('금액에 가중치를 곱하면 금액이다 — 음수 금액도 그대로 가중한다', () => {
    expect(scale(amount(3000), 0.4)).toBeCloseTo(1200, 10);
    expect(scale(amount(-1000), 0.4)).toBeCloseTo(-400, 10);
  });

  it('유한하지 않은 가중치는 거부한다', () => {
    expect(() => scale(amount(100), Number.NaN)).toThrow(/가중치/);
  });
});
