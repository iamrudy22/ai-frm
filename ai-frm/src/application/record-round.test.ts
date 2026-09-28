import { describe, it, expect } from 'vitest';
import { recordRound } from '@/application/record-round';
import type { ForecastLedgerRepository } from '@/application/ports';
import { emptyLedger, type ForecastLedger } from '@/domain/cashflow/forecast-ledger';
import type { RoundEntry } from '@/domain/cashflow/round-entry';
import { amount } from '@/domain/shared/amount';
import { addMonths, parseYearMonth } from '@/domain/shared/year-month';

class MemoryRepository implements ForecastLedgerRepository {
  saves = 0;
  constructor(public ledger: ForecastLedger = emptyLedger()) {}
  async load() {
    return this.ledger;
  }
  async save(ledger: ForecastLedger) {
    this.saves++;
    this.ledger = ledger;
  }
}

function entry(round: string): RoundEntry {
  const r = parseYearMonth(round);
  return {
    round: r,
    actual: { month: addMonths(r, -1), value: amount(107) },
    plan: { month: r, values: [amount(1), amount(2), amount(3)], beyondPlanYear: false },
  };
}

describe('회차 반영', () => {
  it('이력을 불러와 기재분을 반영하고 저장한다', async () => {
    const repo = new MemoryRepository();
    const out = await recordRound(repo, entry('2026/08'));
    expect(out).toEqual({ ok: true, value: { latestActualMonth: '2026/07', gaps: [] } });
    expect(repo.saves).toBe(1);
    expect(repo.ledger.actualOf(parseYearMonth('2026/07'))).toBe(107);
  });

  it('같은 회차를 두 번 반영해도 저장된 이력이 같다', async () => {
    const repo = new MemoryRepository();
    await recordRound(repo, entry('2026/08'));
    const first = repo.ledger.snapshot();
    await recordRound(repo, entry('2026/08'));
    expect(repo.ledger.snapshot()).toEqual(first);
  });

  it('빈 달이 생기면 알려 준다', async () => {
    const repo = new MemoryRepository();
    await recordRound(repo, entry('2026/06'));
    const out = await recordRound(repo, entry('2026/08'));
    expect(out.ok && out.value.gaps).toEqual(['2026/06', '2026/07']);
  });

  it('저장소가 실패하면 사유를 돌려주고 던지지 않는다', async () => {
    const repo = new MemoryRepository();
    repo.save = async () => {
      throw new Error('디스크가 가득 찼습니다');
    };
    expect(await recordRound(repo, entry('2026/08'))).toEqual({ ok: false, reason: '디스크가 가득 찼습니다' });
  });
});
