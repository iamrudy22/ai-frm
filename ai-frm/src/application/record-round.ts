/**
 * 유스케이스: 회차 반영 — 최신 회차에서 뗀 기재분을 분양회수 계획·실적 이력에
 * 쌓는다.
 *
 * 규칙(칸의 주인, 과거 실적 보존, 멱등)은 이력 애그리거트가 지킨다. 여기서는
 * 불러오기 → 반영 → 저장의 순서만 맡는다. 사용자는 한 명이고 월 1회 반영이라
 * 잠금은 두지 않는다. 대신 저장소가 원자적으로 쓴다.
 */

import { settleAsync, succeed, type Outcome } from '@/application/outcome';
import type { ForecastLedgerRepository } from '@/application/ports';
import type { RoundEntry } from '@/domain/cashflow/round-entry';
import type { YearMonth } from '@/domain/shared/year-month';

export type RecordedRound = {
  /** 반영 뒤 이력의 마지막 회차. */
  readonly latestRound: YearMonth | null;
  /** 첫 회차와 마지막 회차 사이에 빠진 회차. 어느 회차를 더 올려야 하는지 알려 줄 때 쓴다. */
  readonly missingRounds: readonly YearMonth[];
};

export async function recordRound(
  repo: ForecastLedgerRepository,
  entry: RoundEntry,
): Promise<Outcome<RecordedRound>> {
  return settleAsync(async () => {
    const ledger = (await repo.load()).record(entry);
    await repo.save(ledger);
    return succeed({ latestRound: ledger.latestRound(), missingRounds: [...ledger.missingRounds()] });
  }, '회차를 이력에 반영하지 못했습니다.');
}
