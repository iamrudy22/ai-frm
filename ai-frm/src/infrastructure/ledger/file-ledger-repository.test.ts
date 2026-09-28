import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLedgerRepository } from '@/infrastructure/ledger/file-ledger-repository';
import type { RoundEntry } from '@/domain/cashflow/round-entry';
import { amount } from '@/domain/shared/amount';
import { parseYearMonth } from '@/domain/shared/year-month';

const ENTRY: RoundEntry = {
  round: parseYearMonth('2026/08'),
  actual: { month: parseYearMonth('2026/07'), value: amount(107) },
  plan: { month: parseYearMonth('2026/08'), values: [amount(1), amount(2), amount(3)], beyondPlanYear: false },
};

describe('이력 파일 저장소', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    path = join(dir, 'data', 'forecast-ledger.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('파일이 없으면 빈 이력이다', async () => {
    const ledger = await new FileLedgerRepository(path).load();
    expect(ledger.latestActualMonth()).toBeNull();
  });

  it('저장했다가 불러오면 같은 이력이다 — 폴더가 없으면 만든다', async () => {
    const repo = new FileLedgerRepository(path);
    const saved = (await repo.load()).record(ENTRY);
    await repo.save(saved);
    expect(existsSync(path)).toBe(true);
    expect((await repo.load()).snapshot()).toEqual(saved.snapshot());
  });

  it('쓰고 난 뒤 임시 파일이 남지 않는다', async () => {
    const repo = new FileLedgerRepository(path);
    await repo.save((await repo.load()).record(ENTRY));
    expect(readdirSync(join(dir, 'data'))).toEqual(['forecast-ledger.json']);
  });

  it('불변식이 깨진 파일은 거부한다 — 손으로 고친 파일도 그냥 쓰지 않는다', async () => {
    const repo = new FileLedgerRepository(path);
    await repo.save((await repo.load()).record(ENTRY));
    writeFileSync(
      path,
      JSON.stringify({ version: 1, rows: [{ month: '2026/07', actual: 1, actualFrom: '2026/07' }] }),
    );
    await expect(repo.load()).rejects.toThrow(/주인 회차/);
  });

  it('JSON이 아닌 파일은 거부한다', async () => {
    const repo = new FileLedgerRepository(path);
    await repo.save((await repo.load()).record(ENTRY));
    writeFileSync(path, '{ 깨진');
    await expect(repo.load()).rejects.toThrow(/이력 파일/);
  });
});
