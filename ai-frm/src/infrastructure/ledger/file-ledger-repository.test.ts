import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLedgerRepository } from '@/infrastructure/ledger/file-ledger-repository';
import type { RoundEntry } from '@/domain/cashflow/round-entry';
import { amount } from '@/domain/shared/amount';
import { parseYearMonth } from '@/domain/shared/year-month';

const ENTRY: RoundEntry = {
  round: parseYearMonth('2026/03'),
  sheetStart: parseYearMonth('2026/01'),
  actuals: [
    { month: parseYearMonth('2026/01'), value: amount(101) },
    { month: parseYearMonth('2026/02'), value: amount(102) },
  ],
  plans: ['2026/03', '2026/04', '2026/05', '2026/06'].map((m, i) => ({ month: parseYearMonth(m), value: amount(i + 1) })) as unknown as RoundEntry['plans'],
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
    expect(ledger.latestRound()).toBeNull();
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

  it('판형 1(달 단위) 파일은 거부한다 — 새 정의로 계산할 수 없다', async () => {
    const repo = new FileLedgerRepository(path);
    await repo.save((await repo.load()).record(ENTRY));
    writeFileSync(
      path,
      JSON.stringify({ version: 1, rows: [{ month: '2026/07', actual: 1, actualFrom: '2026/07' }] }),
    );
    await expect(repo.load()).rejects.toThrow(/판형 1/);
  });

  it('JSON이 아닌 파일은 거부한다', async () => {
    const repo = new FileLedgerRepository(path);
    await repo.save((await repo.load()).record(ENTRY));
    writeFileSync(path, '{ 깨진');
    await expect(repo.load()).rejects.toThrow(/이력 파일/);
  });
});
