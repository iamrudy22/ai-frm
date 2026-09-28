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
  const sheetStart = parseYearMonth(`${round.slice(0, 4)}/01`);
  const actuals = [];
  for (let m = sheetStart; m < r; m = addMonths(m, 1)) actuals.push({ month: m, value: amount(107) });
  const plan = (i: number) => ({ month: addMonths(r, i), value: amount(i + 1) });
  return { round: r, sheetStart, actuals, plans: [plan(0), plan(1), plan(2), plan(3)] };
}

describe('회차 반영', () => {
  it('이력을 불러와 기재분을 반영하고 저장한다', async () => {
    const repo = new MemoryRepository();
    const out = await recordRound(repo, entry('2026/08'));
    expect(out).toEqual({ ok: true, value: { latestRound: '2026/08', missingRounds: [] } });
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

  it('빠진 회차가 생기면 알려 준다', async () => {
    const repo = new MemoryRepository();
    await recordRound(repo, entry('2026/06'));
    const out = await recordRound(repo, entry('2026/08'));
    expect(out.ok && out.value.missingRounds).toEqual(['2026/07']);
  });

  it('저장소가 실패하면 사유를 돌려주고 던지지 않는다', async () => {
    const repo = new MemoryRepository();
    repo.save = async () => {
      throw new Error('디스크가 가득 찼습니다');
    };
    expect(await recordRound(repo, entry('2026/08'))).toEqual({ ok: false, reason: '디스크가 가득 찼습니다' });
  });
});
