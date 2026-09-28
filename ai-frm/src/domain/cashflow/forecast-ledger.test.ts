import { describe, it, expect } from 'vitest';
import { emptyLedger, ledgerFrom, type LedgerSnapshot } from '@/domain/cashflow/forecast-ledger';
import type { RoundEntry } from '@/domain/cashflow/round-entry';
import { amount } from '@/domain/shared/amount';
import { parseYearMonth, type YearMonth } from '@/domain/shared/year-month';

const ym = (s: string) => parseYearMonth(s);

function entry(round: string, actual: number | null, plan: [number, number, number]): RoundEntry {
  const r = ym(round);
  const [y, m] = round.split('/').map(Number);
  const prev = (m === 1 ? `${y - 1}/12` : `${y}/${String(m - 1).padStart(2, '0')}`) as YearMonth;
  return {
    round: r,
    actual: actual === null ? { month: prev, missing: '열 없음' } : { month: prev, value: amount(actual) },
    plan: { month: r, values: [amount(plan[0]), amount(plan[1]), amount(plan[2])], beyondPlanYear: false },
  };
}

describe('분양회수 계획·실적 이력', () => {
  it('회차 하나가 직전 월 실적과 그 달 계획을 남긴다', () => {
    const ledger = emptyLedger().record(entry('2026/08', 107, [108, 109, 110]));
    expect(ledger.actualOf(ym('2026/07'))).toBe(107);
    expect(ledger.planOf(ym('2026/08'))).toEqual([108, 109, 110]);
    expect(ledger.actualOf(ym('2026/08'))).toBeUndefined();
    expect(ledger.latestActualMonth()).toBe('2026/07');
  });

  it('record는 새 이력을 돌려주고 원래 이력은 그대로다', () => {
    const before = emptyLedger();
    before.record(entry('2026/08', 107, [108, 109, 110]));
    expect(before.latestActualMonth()).toBeNull();
  });

  it('같은 회차를 다시 반영하면 그 칸을 덮는다 — 두 번 올려도 같다', () => {
    const once = emptyLedger().record(entry('2026/08', 107, [108, 109, 110]));
    const twice = once.record(entry('2026/08', 107, [108, 109, 110]));
    expect(twice.snapshot()).toEqual(once.snapshot());

    const corrected = once.record(entry('2026/08', 999, [1, 2, 3]));
    expect(corrected.actualOf(ym('2026/07'))).toBe(999);
  });

  // 실적은 각 달 직후 회차의 값으로 고정된다(정책 §3-3). 9월 회차는 8월 실적만 쓴다.
  it('나중 회차는 과거 실적을 덮지 않는다', () => {
    const ledger = emptyLedger()
      .record(entry('2026/08', 107, [108, 109, 110]))
      .record(entry('2026/09', 208, [209, 210, 211]));
    expect(ledger.actualOf(ym('2026/07'))).toBe(107);
    expect(ledger.actualOf(ym('2026/08'))).toBe(208);
    expect(ledger.planOf(ym('2026/08'))).toEqual([108, 109, 110]);
  });

  it('실적이 빈 기재분(1월 회차)은 계획만 남긴다', () => {
    const ledger = emptyLedger().record(entry('2027/01', null, [1, 2, 3]));
    expect(ledger.actualOf(ym('2026/12'))).toBeUndefined();
    expect(ledger.planOf(ym('2027/01'))).toEqual([1, 2, 3]);
  });

  it('가장 이른 계획 달부터 최신 실적 달까지 비어 있는 달을 알려 준다', () => {
    const ledger = emptyLedger()
      .record(entry('2026/05', 1, [1, 1, 1]))
      .record(entry('2026/06', 1, [1, 1, 1]))
      // 7월 회차를 빠뜨렸다: 6월 실적과 7월 계획이 없다
      .record(entry('2026/08', 1, [1, 1, 1]));
    expect(ledger.gaps()).toEqual(['2026/06', '2026/07']);
  });
});

describe('가장 이른 계획 달', () => {
  it('계획이 있는 가장 이른 달이다 — 이 달 + 2부터 오차율을 낼 수 있다', () => {
    const ledger = emptyLedger()
      .record(entry('2026/08', 1, [1, 1, 1]))
      .record(entry('2026/06', 1, [1, 1, 1]));
    expect(ledger.firstPlanMonth()).toBe('2026/06');
  });

  it('계획이 없으면 없다', () => {
    expect(emptyLedger().firstPlanMonth()).toBeNull();
  });
});

describe('저장 형태와 복원', () => {
  it('스냅샷으로 저장했다가 되살리면 같은 이력이다', () => {
    const ledger = emptyLedger()
      .record(entry('2026/07', 106, [107, 108, 109]))
      .record(entry('2026/08', 107, [108, 109, 110]));
    const restored = ledgerFrom(JSON.parse(JSON.stringify(ledger.snapshot())));
    expect(restored.snapshot()).toEqual(ledger.snapshot());
    expect(restored.actualOf(ym('2026/07'))).toBe(107);
  });

  it('스냅샷은 달 순서로 정렬되어 있다', () => {
    const snap = emptyLedger()
      .record(entry('2026/08', 1, [1, 1, 1]))
      .record(entry('2026/06', 1, [1, 1, 1]))
      .snapshot();
    expect(snap.rows.map((r) => r.month)).toEqual(['2026/05', '2026/06', '2026/07', '2026/08']);
  });

  // 파일을 손으로 고쳐도 불변식이 깨진 이력은 만들어지지 않는다.
  it.each([
    ['실적의 주인은 다음 달 회차다', { month: '2026/07', actual: 1, actualFrom: '2026/07' }],
    ['계획의 주인은 그 달 회차다', { month: '2026/07', plan: [1, 2, 3], planFrom: '2026/06' }],
    ['주인 회차가 없는 실적', { month: '2026/07', actual: 1 }],
    ['금액이 유한하지 않다', { month: '2026/07', actual: null, actualFrom: '2026/08' }],
    ['계획이 세 칸이 아니다', { month: '2026/07', plan: [1, 2], planFrom: '2026/07' }],
  ])('불변식을 어긴 스냅샷은 거부한다 — %s', (_, row) => {
    expect(() => ledgerFrom({ version: 1, rows: [row] } as unknown as LedgerSnapshot)).toThrow();
  });

  it('같은 달이 두 줄이면 거부한다', () => {
    const row = { month: '2026/07', actual: 1, actualFrom: '2026/08' };
    expect(() => ledgerFrom({ version: 1, rows: [row, row] } as unknown as LedgerSnapshot)).toThrow();
  });

  it('모르는 판형은 거부한다', () => {
    expect(() => ledgerFrom({ version: 2, rows: [] } as unknown as LedgerSnapshot)).toThrow(/판형/);
  });

  it('시드한 칸은 표시가 남고, 같은 주인 회차가 올라오면 덮인다', () => {
    const seeded = ledgerFrom({
      version: 1,
      rows: [{ month: ym('2026/07'), actual: amount(107), actualFrom: ym('2026/08'), actualSeeded: true }],
    });
    expect(seeded.snapshot().rows[0].actualSeeded).toBe(true);

    const replaced = seeded.record(entry('2026/08', 107, [108, 109, 110]));
    expect(replaced.snapshot().rows.find((r) => r.month === '2026/07')?.actualSeeded).toBeUndefined();
  });
});
