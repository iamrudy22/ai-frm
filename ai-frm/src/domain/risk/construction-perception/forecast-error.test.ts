import { describe, it, expect } from 'vitest';
import { emptyLedger, type ForecastLedger } from '@/domain/cashflow/forecast-ledger';
import type { PlanCell, RoundEntry } from '@/domain/cashflow/round-entry';
import { isMissing } from '@/domain/risk/construction-perception/construction-perception';
import { forecastErrorAt, forecastErrorForBaseMonth, roundsNeededFor } from '@/domain/risk/construction-perception/forecast-error';
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

// 엑셀 재무위기인식지수_위기단계는 7월 지수에 분양회수data "2026/08" 행을 쓴다 — 실적이 7월에서
// 끝나는 창이다. 기준월 b의 지수는 b+1 행(실적 b−2 ~ b)을 쓴다(정책 §3-2, 2026-09-28 결정).
describe('기준월 지수에 쓰는 오차율 — 엑셀 위기단계와 같다', () => {
  it('기준월 6월 지수는 "2026/07" 행(4·5·6월 실적)이다', () => {
    expect(forecastErrorForBaseMonth(julyLedger(), ym('2026/06'))).toBe(forecastErrorAt(julyLedger(), ym('2026/07')));
  });

  it('필요한 회차는 b−2 ~ b+1 — 기준월 6월이면 4~7월 회차 네 개', () => {
    expect(roundsNeededFor(ym('2026/06'))).toEqual(['2026/04', '2026/05', '2026/06', '2026/07']);
  });

  it('해를 넘긴다 — 기준월 1월이면 전년 11월 ~ 2월 회차', () => {
    expect(roundsNeededFor(ym('2026/01'))).toEqual(['2025/11', '2025/12', '2026/01', '2026/02']);
  });
});
