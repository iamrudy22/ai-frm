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
 * 7월 라벨에 쓰는 두 회차: 4월 회차의 4·5·6월 계획 100·200·300, 7월 회차에 적힌
 * 4·5·6월 실적 150·250·350.
 */
function julyLedger(): ForecastLedger {
  return emptyLedger()
    .record(entry('2026/04', {}, [100, 200, 300, 999]))
    .record(entry('2026/07', { '2026/04': 150, '2026/05': 250, '2026/06': 350 }));
}

describe('분양회수 예측오차 (정책 §3-2, 2026-09-28 재개정 — t월 회차 한 장의 실적)', () => {
  // (150 + 250 + 350 − (100 + 200 + 300)) ÷ 600 = 150 ÷ 600
  it('7월 = (7월 회차의 4·5·6월 실적 − 4월 회차 4·5·6월 계획) ÷ 같은 계획 — 계획 넷째 칸은 안 쓴다', () => {
    expect(forecastErrorAt(julyLedger(), ym('2026/07'))).toBeCloseTo(0.25, 12);
  });

  it('사이 회차(5·6월)에 적힌 실적은 쓰지 않는다 — 값이 달라도 7월 회차 값이다', () => {
    const ledger = julyLedger()
      .record(entry('2026/05', { '2026/04': 777 }))
      .record(entry('2026/06', { '2026/04': 777, '2026/05': 777 }));
    expect(forecastErrorAt(ledger, ym('2026/07'))).toBeCloseTo(0.25, 12);
  });

  it('계획대로 걷히면 0이다', () => {
    const ledger = emptyLedger()
      .record(entry('2026/04', {}, [100, 100, 100, 0]))
      .record(entry('2026/07', { '2026/04': 100, '2026/05': 100, '2026/06': 100 }));
    expect(forecastErrorAt(ledger, ym('2026/07'))).toBe(0);
  });

  it.each([
    ['계획 회차(t−3)가 없으면', () => emptyLedger().record(julyLedger().entryOf(ym('2026/07')) as RoundEntry), '분양회수: 계획을 세운 2026/04 회차를 올리지 않았습니다.'],
    ['실적 회차(t)가 없으면', () => emptyLedger().record(julyLedger().entryOf(ym('2026/04')) as RoundEntry), '분양회수: 실적을 읽는 2026/07 회차를 올리지 않았습니다.'],
    ['둘 다 없으면 둘 다', () => emptyLedger().record(entry('2026/05')), '분양회수: 계획을 세운 2026/04 회차와 실적을 읽는 2026/07 회차를 올리지 않았습니다.'],
    [
      '계획 칸이 없으면 그 사유',
      () => julyLedger().record(entry('2026/04', {}, [100, 200, '2026/04 회차 시트에 2026/06 열이 없습니다.', 0])),
      '분양회수: 2026/04 회차 시트에 2026/06 열이 없습니다.',
    ],
    ['계획 합이 0 이하이면', () => julyLedger().record(entry('2026/04', {}, [0, 0, 0, 1])), '분양회수: 2026/04 회차의 3개월 계획 합이 0이라 오차율을 낼 수 없습니다.'],
  ])('%s 결측이다', (_, build, reason) => {
    expect(forecastErrorAt(build(), ym('2026/07'))).toEqual({ missing: reason });
  });

  it('1~3월 회차에는 전년 달 실적이 없어 결측이다 — 2월이면 2025/11·12월', () => {
    const ledger = emptyLedger().record(entry('2025/11', {}, [100, 100, 100, 0])).record(entry('2026/02'));
    const r = forecastErrorAt(ledger, ym('2026/02'));
    expect(isMissing(r) && r.missing).toBe('분양회수: 2026/02 회차 시트는 2026/01부터라 2025/11 실적 열이 없습니다.');
  });
});

// N월 기준(최신 회차 N)은 기준월 N−2이고, 분양회수는 N월 회차의 실적과 N−3월 회차의 계획을
// 쓴다. 기준월 b로 말하면 b+2 행(실적 b−1 ~ b+1)이다(정책 §3-2, 2026-09-28 결정).
describe('기준월 지수에 쓰는 오차율 — b+2월 회차 실적, b−1월 회차 계획', () => {
  it('기준월 5월(7월 기준) 지수는 7월 회차의 4·5·6월 실적이다', () => {
    expect(forecastErrorForBaseMonth(julyLedger(), ym('2026/05'))).toBe(forecastErrorAt(julyLedger(), ym('2026/07')));
  });

  it('필요한 회차는 두 개 — 기준월 6월(8월 기준)이면 5월(계획)·8월(실적)', () => {
    expect(roundsNeededFor(ym('2026/06'))).toEqual({ plan: '2026/05', actual: '2026/08' });
  });

  it('해를 넘긴다 — 기준월 1월이면 전년 12월(계획)·3월(실적)', () => {
    expect(roundsNeededFor(ym('2026/01'))).toEqual({ plan: '2025/12', actual: '2026/03' });
  });
});
