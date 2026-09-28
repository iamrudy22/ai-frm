import { describe, it, expect } from 'vitest';
import { emptyLedger } from '@/domain/cashflow/forecast-ledger';
import type { RoundEntry } from '@/domain/cashflow/round-entry';
import { isMissing } from '@/domain/risk/construction-perception/construction-perception';
import { forecastErrorAt } from '@/domain/risk/construction-perception/forecast-error';
import { amount } from '@/domain/shared/amount';
import { addMonths, parseYearMonth } from '@/domain/shared/year-month';

const ym = (s: string) => parseYearMonth(s);

function entry(round: string, actual: number, plan: [number, number, number]): RoundEntry {
  const r = ym(round);
  return {
    round: r,
    actual: { month: addMonths(r, -1), value: amount(actual) },
    plan: { month: r, values: [amount(plan[0]), amount(plan[1]), amount(plan[2])], beyondPlanYear: false },
  };
}

// 5월 회차가 5·6·7월 계획 100·100·100을 세웠고, 실적이 90·80·70이었다.
// 오차율(7월) = (240 − 300) / 300 = −20%
const LEDGER = emptyLedger()
  .record(entry('2026/05', 1, [100, 100, 100]))
  .record(entry('2026/06', 90, [1, 1, 1]))
  .record(entry('2026/07', 80, [1, 1, 1]))
  .record(entry('2026/08', 70, [1, 1, 1]));

describe('분양회수 예측오차 (정책 §3-2)', () => {
  it('두 달 전 회차가 세운 3개월 계획 대비 그 3개월 실적의 오차율', () => {
    expect(forecastErrorAt(LEDGER, ym('2026/07'))).toBeCloseTo(-0.2, 12);
  });

  it('계획보다 더 걷혔으면 양수다', () => {
    const over = emptyLedger()
      .record(entry('2026/05', 0, [100, 100, 100]))
      .record(entry('2026/06', 110, [1, 1, 1]))
      .record(entry('2026/07', 120, [1, 1, 1]))
      .record(entry('2026/08', 130, [1, 1, 1]));
    expect(forecastErrorAt(over, ym('2026/07'))).toBeCloseTo(0.2, 12);
  });

  it('창 안의 실적이 하나라도 없으면 결측이다 — 사유에 그 달이 있다', () => {
    const r = forecastErrorAt(LEDGER, ym('2026/08'));
    expect(isMissing(r)).toBe(true);
    if (isMissing(r)) expect(r.missing).toContain('2026/08');
  });

  it('두 달 전 회차의 계획이 없으면 결측이다', () => {
    const r = forecastErrorAt(LEDGER, ym('2026/06'));
    expect(isMissing(r)).toBe(true);
    if (isMissing(r)) expect(r.missing).toContain('2026/04');
  });

  it('계획 합이 0 이하이면 오차율을 낼 수 없다', () => {
    const zero = emptyLedger()
      .record(entry('2026/05', 0, [0, 0, 0]))
      .record(entry('2026/06', 1, [1, 1, 1]))
      .record(entry('2026/07', 1, [1, 1, 1]))
      .record(entry('2026/08', 1, [1, 1, 1]));
    expect(isMissing(forecastErrorAt(zero, ym('2026/07')))).toBe(true);
  });
});
