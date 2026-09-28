import { describe, it, expect } from 'vitest';
import { emptyLedger } from '@/domain/cashflow/forecast-ledger';
import type { PlanCell, RoundEntry } from '@/domain/cashflow/round-entry';
import { isMissing } from '@/domain/risk/construction-perception/construction-perception';
import { forecastErrorAt } from '@/domain/risk/construction-perception/forecast-error';
import { amount } from '@/domain/shared/amount';
import { addMonths, parseYearMonth } from '@/domain/shared/year-month';

const ym = (s: string) => parseYearMonth(s);

/** 회차 기재분. actuals: 시트 첫 달부터 직전 달까지의 값, plans: 그달부터 4개월. */
function entry(round: string, actuals: number[], plans: (number | string)[] = [0, 0, 0, 0], sheetStart = `${round.slice(0, 4)}/01`): RoundEntry {
  const r = ym(round);
  return {
    round: r,
    sheetStart: ym(sheetStart),
    actuals: actuals.map((v, i) => ({ month: addMonths(ym(sheetStart), i), value: amount(v) })),
    plans: plans.map((v, i): PlanCell => {
      const month = addMonths(r, i);
      return typeof v === 'string' ? { month, missing: v } : { month, value: amount(v) };
    }) as unknown as RoundEntry['plans'],
  };
}

const zeros = (n: number) => Array.from({ length: n }, () => 0);

describe('분양회수 예측오차 (정책 §3-2, 2026-09-28 개정)', () => {
  // 7월: (7월 회차의 4·5·6월 실적 − 5월 회차의 6·7·8월 계획) ÷ 5월 회차의 5·6·7월 계획
  it('7월 = (7월 회차 4·5·6월 실적 − 5월 회차 6·7·8월 계획) ÷ 5월 회차 5·6·7월 계획', () => {
    const ledger = emptyLedger()
      .record(entry('2026/05', zeros(4), [100, 200, 300, 400]))
      .record(entry('2026/07', [0, 0, 0, 150, 250, 350]));
    // 실적 150+250+350 = 750, 분자 계획 200+300+400 = 900, 분모 계획 100+200+300 = 600
    expect(forecastErrorAt(ledger, ym('2026/07'))).toBeCloseTo((750 - 900) / 600, 12);
  });

  // 분자와 분모의 계획 창이 달라 계획대로 걷혀도 0이 아닐 수 있다(정책 §3-2).
  it('계획대로 걷혀도 창이 달라 0이 아닐 수 있다 — 5월 회차 계획 100·100·100·400이면 −100%', () => {
    const ledger = emptyLedger()
      .record(entry('2026/05', zeros(4), [100, 100, 100, 400]))
      .record(entry('2026/07', [0, 0, 0, 100, 100, 100]));
    expect(forecastErrorAt(ledger, ym('2026/07'))).toBeCloseTo(-1, 12);
  });

  it('실적은 기준월 회차 한 장의 값이다 — 다른 회차가 같은 달을 다르게 적었어도', () => {
    const ledger = emptyLedger()
      .record(entry('2026/05', zeros(4), [100, 100, 100, 100]))
      .record(entry('2026/06', [0, 0, 0, 999, 999]))
      .record(entry('2026/07', [0, 0, 0, 100, 100, 100]));
    expect(forecastErrorAt(ledger, ym('2026/07'))).toBeCloseTo(0, 12);
  });

  it('1~3월 기준월의 전년 실적은 그 달이 실적인 전년도 회차에서 채운다', () => {
    const ledger = emptyLedger()
      .record(entry('2026/02', [100])) // 2026년 파일: 1월 실적만
      .record(entry('2025/12', [...zeros(9), 100, 100], [100, 100, 100, 100], '2025/01')); // 10·11월 100
    // 2월 = 2월 회차의 (2025/11, 2025/12, 2026/01) − 12월 회차 (1·2·3월) ÷ 12월 회차 (12·1·2월)
    // 2025/12 실적은 어느 회차에도 실적으로 없다 → 결측
    const r = forecastErrorAt(ledger, ym('2026/02'));
    expect(isMissing(r) && r.missing).toContain('2025/12');
  });

  it.each([
    ['기준월 회차가 없으면', (l: ReturnType<typeof emptyLedger>) => l.record(entry('2026/05', zeros(4), [1, 1, 1, 1])), '2026/07 회차'],
    ['두 달 전 회차가 없으면', (l: ReturnType<typeof emptyLedger>) => l.record(entry('2026/07', zeros(6))), '2026/05 회차'],
    [
      '계획 칸이 없으면 그 사유',
      (l: ReturnType<typeof emptyLedger>) =>
        l.record(entry('2026/05', zeros(4), [1, 1, 1, '5월 회차 시트에 2026/08 열이 없습니다.'])).record(entry('2026/07', zeros(6))),
      '2026/08 열',
    ],
    [
      '분모 계획 합이 0 이하이면',
      (l: ReturnType<typeof emptyLedger>) =>
        l.record(entry('2026/05', zeros(4), [0, 0, 0, 1])).record(entry('2026/07', zeros(6))),
      '0',
    ],
  ])('%s 결측이다', (_, build, reason) => {
    const r = forecastErrorAt(build(emptyLedger()), ym('2026/07'));
    expect(isMissing(r)).toBe(true);
    if (isMissing(r)) expect(r.missing).toContain(reason);
  });
});

