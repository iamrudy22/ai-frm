import { describe, it, expect } from 'vitest';
import { emptyLedger, ledgerFrom, type LedgerSnapshot } from '@/domain/cashflow/forecast-ledger';
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
    expect(once.record(entry('2026/07')).snapshot()).toEqual(once.snapshot());
  });

  it('첫 회차와 마지막 회차 사이에 빠진 회차를 알려 준다', () => {
    const ledger = emptyLedger().record(entry('2026/04')).record(entry('2026/07'));
    expect(ledger.missingRounds()).toEqual(['2026/05', '2026/06']);
  });
});

describe('실적 — 기준월 회차 한 장에서 읽는다 (정책 §3-2)', () => {
  it('회차 시트에 있는 달은 그 회차의 값이다 — 다른 회차가 같은 달을 적었어도', () => {
    const ledger = emptyLedger().record(entry('2026/07')).record(entry('2026/08'));
    expect(ledger.actualFor(ym('2026/07'), ym('2026/04'))).toBe(7004);
  });

  it('회차가 이력에 없으면 결측이다', () => {
    expect(emptyLedger().actualFor(ym('2026/07'), ym('2026/04'))).toEqual({
      missing: expect.stringContaining('2026/07 회차'),
    });
  });

  it('회차 시트에 없는 전년 달은 그 달이 실적인 가장 최근 회차에서 채운다', () => {
    const ledger = emptyLedger()
      .record(entry('2026/01')) // 2026년 파일 — 전년 열 없음
      .record(entry('2025/11', '2025/01')) // 전년도 파일 — 2025/01~10 실적
      .record(entry('2025/12', '2025/01')); // 전년도 파일 — 2025/01~11 실적
    expect(ledger.actualFor(ym('2026/01'), ym('2025/10'))).toBe(12010);
    expect(ledger.actualFor(ym('2026/01'), ym('2025/11'))).toBe(12011);
  });

  it('그 달이 실적인 회차가 없으면 결측이고, 어느 달인지 알린다', () => {
    const ledger = emptyLedger().record(entry('2026/01')).record(entry('2025/12', '2025/01'));
    expect(ledger.actualFor(ym('2026/01'), ym('2025/12'))).toEqual({
      missing: expect.stringContaining('2025/12'),
    });
  });
});

describe('저장 형태와 복원', () => {
  it('스냅샷으로 저장했다가 되살리면 같은 이력이다', () => {
    const ledger = emptyLedger().record(entry('2026/05')).record(entry('2026/07'));
    const restored = ledgerFrom(JSON.parse(JSON.stringify(ledger.snapshot())));
    expect(restored.snapshot()).toEqual(ledger.snapshot());
    expect(restored.actualFor(ym('2026/07'), ym('2026/04'))).toBe(7004);
  });

  it('스냅샷은 판형 2이고 회차 순서로 정렬되어 있다', () => {
    const snap = emptyLedger().record(entry('2026/07')).record(entry('2026/05')).snapshot();
    expect(snap.version).toBe(2);
    expect(snap.rounds.map((r) => r.round)).toEqual(['2026/05', '2026/07']);
  });

  // 판형 1(달 단위, 회차마다 실적 1개·계획 3개)으로는 새 정의를 계산할 수 없다.
  it('판형 1은 거부하고 이유를 알린다', () => {
    expect(() => ledgerFrom({ version: 1, rows: [] } as unknown as LedgerSnapshot)).toThrow(/판형 1/);
  });

  it('기재분 불변식을 어긴 회차는 거부한다', () => {
    const bad = { ...entry('2026/07'), plans: entry('2026/07').plans.slice(0, 3) };
    expect(() => ledgerFrom({ version: 2, rounds: [bad] } as unknown as LedgerSnapshot)).toThrow();
  });

  it('같은 회차가 두 번 있으면 거부한다', () => {
    const e = entry('2026/07');
    expect(() => ledgerFrom({ version: 2, rounds: [e, e] } as unknown as LedgerSnapshot)).toThrow(/두 번/);
  });
});
