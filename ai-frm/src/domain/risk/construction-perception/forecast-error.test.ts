import { describe, it, expect } from 'vitest';
import { emptyLedger, type ForecastLedger } from '@/domain/cashflow/forecast-ledger';
import type { PlanCell, RoundEntry } from '@/domain/cashflow/round-entry';
import { isMissing } from '@/domain/risk/construction-perception/construction-perception';
import { forecastErrorAt } from '@/domain/risk/construction-perception/forecast-error';
import { amount } from '@/domain/shared/amount';
import { addMonths, parseYearMonth } from '@/domain/shared/year-month';

const ym = (s: string) => parseYearMonth(s);

/**
 * 회차 기재분. actuals: 시트 첫 달(그해 1월)부터 직전 달까지, plans: 그달부터 4칸.
 * 값을 주지 않은 실적은 0이다.
 */
function entry(round: string, actuals: Record<string, number> = {}, plans: (number | string)[] = [0, 0, 0, 0]): RoundEntry {
  const r = ym(round);
  const sheetStart = ym(`${round.slice(0, 4)}/01`);
  const list = [];
  for (let m = sheetStart; m < r; m = addMonths(m, 1)) list.push({ month: m, value: amount(actuals[m] ?? 0) });
  return {
    round: r,
    sheetStart,
    actuals: list,
    plans: plans.map((v, i): PlanCell => {
      const month = addMonths(r, i);
      return typeof v === 'string' ? { month, missing: v } : { month, value: amount(v) };
    }) as unknown as RoundEntry['plans'],
  };
}

/**
 * 7월 기준월에 필요한 네 회차. 4월 회차의 4·5·6월 계획 100·200·300,
 * 4·5·6월 실적은 각 달 직후 회차(5·6·7월 회차)의 값 150·250·350.
 * 나중 회차가 정산해 다르게 적은 값은 777이다.
 */
function julyLedger(): ForecastLedger {
  return emptyLedger()
    .record(entry('2026/04', {}, [100, 200, 300, 999]))
    .record(entry('2026/05', { '2026/04': 150 }))
    .record(entry('2026/06', { '2026/04': 777, '2026/05': 250 }))
    .record(entry('2026/07', { '2026/04': 777, '2026/05': 777, '2026/06': 350 }));
}

const without = (round: string) => {
  const kept = julyLedger()
    .rounds()
    .filter((r) => r !== round);
  return kept.reduce((l, r) => l.record(julyLedger().entryOf(r) as RoundEntry), emptyLedger());
};

describe('분양회수 예측오차 (정책 §3-2, 2026-09-28 재개정 — 엑셀 분양회수data와 같다)', () => {
  // (150 + 250 + 350 − (100 + 200 + 300)) ÷ 600 = 150 ÷ 600
  it('7월 = (4·5·6월 실적 − 4월 회차 4·5·6월 계획) ÷ 같은 계획 — 실적은 각 달 직후 회차 값, 계획 넷째 칸은 안 쓴다', () => {
    expect(forecastErrorAt(julyLedger(), ym('2026/07'))).toBeCloseTo(0.25, 12);
  });

  it('계획대로 걷히면 0이다', () => {
    const ledger = emptyLedger()
      .record(entry('2026/04', {}, [100, 100, 100, 0]))
      .record(entry('2026/05', { '2026/04': 100 }))
      .record(entry('2026/06', { '2026/05': 100 }))
      .record(entry('2026/07', { '2026/06': 100 }));
    expect(forecastErrorAt(ledger, ym('2026/07'))).toBe(0);
  });

  it.each([
    ['계획 회차(t−3)가 없으면', () => without('2026/04'), '2026/04 회차'],
    ['실적의 직후 회차가 없으면', () => without('2026/06'), '2026/06 회차'],
    [
      '계획 칸이 없으면 그 사유',
      () => julyLedger().record(entry('2026/04', {}, [100, 200, '2026/04 회차 시트에 2026/06 열이 없습니다.', 0])),
      '2026/06 열',
    ],
    ['계획 합이 0 이하이면', () => julyLedger().record(entry('2026/04', {}, [0, 0, 0, 1])), '0'],
  ])('%s 결측이다', (_, build, reason) => {
    const r = forecastErrorAt(build(), ym('2026/07'));
    expect(isMissing(r)).toBe(true);
    if (isMissing(r)) expect(r.missing).toContain(reason);
  });
});
