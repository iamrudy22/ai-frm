/**
 * 분양회수 계획·실적 이력 — JSON 파일 저장소. 서버 전용이다.
 *
 * 불러올 때 ledgerFrom이 불변식을 다시 검사한다. 손으로 고친 파일도 그냥 쓰지
 * 않는다. 쓸 때는 임시 파일에 쓴 뒤 이름을 바꿔, 쓰다 멈춰도 반쯤 쓴 파일이
 * 남지 않게 한다.
 *
 * 서버 한 대, 디스크가 유지되는 환경에서만 맞다(구현 계획 R3). 서버리스로 가면
 * 이 파일만 DB 구현으로 바꾼다. 유스케이스는 포트만 알아서 바뀌지 않는다.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ForecastLedgerRepository } from '@/application/ports';
import { emptyLedger, ledgerFrom, type ForecastLedger } from '@/domain/cashflow/forecast-ledger';

export class FileLedgerRepository implements ForecastLedgerRepository {
  constructor(private readonly path: string) {}

  async load(): Promise<ForecastLedger> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyLedger();
      throw e;
    }

    let snapshot: unknown;
    try {
      snapshot = JSON.parse(text);
    } catch {
      throw new Error(`이력 파일이 JSON이 아닙니다: ${this.path}`);
    }
    return ledgerFrom(snapshot as Parameters<typeof ledgerFrom>[0]);
  }

  async save(ledger: ForecastLedger): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(ledger.snapshot(), null, 2) + '\n', 'utf8');
    await rename(temp, this.path);
  }
}
