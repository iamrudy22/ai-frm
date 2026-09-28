import { describe, it, expect } from 'vitest';
import { emptyLedger, ledgerOf } from '@/domain/cashflow/forecast-ledger';
import type { RoundEntry } from '@/domain/cashflow/round-entry';
import { amount } from '@/domain/shared/amount';
import { addMonths, parseYearMonth, type YearMonth } from '@/domain/shared/year-month';

const ym = (s: string) => parseYearMonth(s);

/**
 * 회차 기재분. 실적 값은 "회차 달 × 1000 + 실적 달"로 두어 어느 회차에서
 * 읽었는지 값만 봐도 알 수 있게 한다(예: 7월 회차의 4월 실적 = 7004).
 */
function entry(round: string, sheetStart = `${round.slice(0, 4)}/01`): RoundEntry {
  const r = ym(round);
  const actuals: { month: YearMonth; value: ReturnType<typeof amount> }[] = [];
  for (let m = ym(sheetStart); m < r; m = addMonths(m, 1)) {
    actuals.push({ month: m, value: amount(Number(round.slice(5)) * 1000 + Number(m.slice(5))) });
  }
  const plan = (i: number) => ({ month: addMonths(r, i), value: amount(100 + i) });
  return { round: r, sheetStart: ym(sheetStart), actuals, plans: [plan(0), plan(1), plan(2), plan(3)] };
}

describe('분양회수 계획·실적 이력 (판형 2, 회차 단위)', () => {
  it('회차마다 기재분 한 건을 담는다', () => {
    const ledger = emptyLedger().record(entry('2026/07')).record(entry('2026/05'));
    expect(ledger.rounds()).toEqual(['2026/05', '2026/07']);
    expect(ledger.firstRound()).toBe('2026/05');
    expect(ledger.latestRound()).toBe('2026/07');
    expect(ledger.planOf(ym('2026/05'))?.map((p) => p.month)).toEqual(['2026/05', '2026/06', '2026/07', '2026/08']);
  });

  it('record는 새 이력을 돌려주고 원래 이력은 그대로다', () => {
    const before = emptyLedger();
    before.record(entry('2026/07'));
    expect(before.rounds()).toEqual([]);
  });

  it('같은 회차를 다시 올리면 그 회차만 바꾼다 — 두 번 올려도 같다', () => {
    const once = emptyLedger().record(entry('2026/05')).record(entry('2026/07'));
    expect(once.record(entry('2026/07')).entryOf(ym('2026/07'))).toEqual(once.entryOf(ym('2026/07')));
    expect(once.record(entry('2026/07')).rounds()).toEqual(once.rounds());
  });

});

describe('실적 — 정한 회차에 적힌 값이다 (정책 §3-2, 2026-09-28 재개정)', () => {
  it('같은 달 실적도 회차마다 다르게 적혀 있을 수 있다 — 고른 회차의 값을 그대로 읽는다', () => {
    const ledger = emptyLedger().record(entry('2026/07')).record(entry('2026/08'));
    expect(ledger.actualOf(ym('2026/07'), ym('2026/06'))).toBe(7006);
    expect(ledger.actualOf(ym('2026/08'), ym('2026/06'))).toBe(8006);
  });

  it('그 회차가 이력에 없으면 결측이다 — 다른 회차에서 채우지 않는다', () => {
    const ledger = emptyLedger().record(entry('2026/07'));
    expect(ledger.actualOf(ym('2026/08'), ym('2026/06'))).toEqual({
      missing: '2026/06 실적은 2026/08 회차에서 읽는데, 그 회차를 올리지 않았습니다.',
    });
  });

  it('그 회차 시트에 없는 전년 달이면 결측이다 — 전년 열이 든 다른 회차가 있어도', () => {
    const ledger = emptyLedger().record(entry('2026/02')).record(entry('2026/03', '2025/10'));
    expect(ledger.actualOf(ym('2026/02'), ym('2025/12'))).toEqual({
      missing: '2026/02 회차 시트는 2026/01부터라 2025/12 실적 열이 없습니다.',
    });
    expect(ledger.actualOf(ym('2026/03'), ym('2025/12'))).toBe(3012);
  });

  it('회차 달과 그 뒤는 실적이 아니다', () => {
    const ledger = emptyLedger().record(entry('2026/07'));
    expect(ledger.actualOf(ym('2026/07'), ym('2026/07'))).toEqual({ missing: '2026/07 회차에 2026/07 실적이 없습니다.' });
  });
});

describe('올린 회차로 만들기 — 저장하지 않는다', () => {
  it('요청으로 받은 회차들로 이력을 만든다 — 순서는 상관없다', () => {
    const ledger = ledgerOf(JSON.parse(JSON.stringify([entry('2026/07'), entry('2026/05')])));
    expect(ledger.rounds()).toEqual(['2026/05', '2026/07']);
    expect(ledger.actualOf(ym('2026/05'), ym('2026/04'))).toBe(5004);
  });

  it('회차가 없으면 빈 이력이다', () => {
    expect(ledgerOf([]).latestRound()).toBeNull();
  });

  it('기재분 불변식을 어긴 회차는 거부한다', () => {
    const bad = { ...entry('2026/07'), plans: entry('2026/07').plans.slice(0, 3) };
    expect(() => ledgerOf([bad])).toThrow(/4칸/);
  });

  it('같은 회차가 두 번 있으면 거부한다 — 어느 파일을 믿을지 알 수 없다', () => {
    const e = entry('2026/07');
    expect(() => ledgerOf([e, e])).toThrow('2026/07 회차가 두 번');
  });

  it('배열이 아니면 거부한다', () => {
    expect(() => ledgerOf({ rounds: [] } as unknown as unknown[])).toThrow(/배열/);
  });
});
