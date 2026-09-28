/**
 * 분양회수 계획·실적 이력 — 올린 회차마다 기재분 한 건을 담는다.
 *
 * 특정 지표의 개념이 아니라 자금수지의 사실이라 회차와 같은 곳에 둔다(DDD 검토
 * §10-2). 건설경기 인식 지수의 분양회수 예측오차가 이 이력을 읽는다.
 *
 * 단위는 **회차**다(정책 §3-3). 분양회수 예측오차(라벨 t)는 t−3월 회차의 계획과
 * t월 회차에 적힌 t−3~t−1월 실적을 쓰므로, 회차를 키로 담는다. 같은 회차를
 * 다시 올리면 그 회차의 기재분을 통째로 바꾼다. 다른 회차는 건드리지 않는다.
 *
 * 실적은 **어느 회차에 적힌 값인지**까지 정해서 읽는다(actualOf). 같은 달 실적도
 * 뒤 회차에서 고쳐져 있어, 회차를 정하지 않으면 값이 하나로 정해지지 않는다.
 * 다른 회차에서 대신 채우지 않는다.
 *
 * 저장하지 않는다(2026-09-28). 산출할 때마다 화면에서 올린 회차들로 새로 만든다
 * (ledgerOf). 이전에 올린 파일이 결과에 섞이지 않는다.
 */

import { roundEntry, type RoundEntry } from '@/domain/cashflow/round-entry';
import type { Amount } from '@/domain/shared/amount';
import { compareYearMonth, type YearMonth } from '@/domain/shared/year-month';

/** 값이 없다는 사실과 그 사유. 0으로 대신하지 않는다. */
export type LedgerMissing = { readonly missing: string };

export type ForecastLedger = {
  /** 유일한 변경 경로. 새 이력을 돌려준다. */
  record(entry: RoundEntry): ForecastLedger;
  rounds(): readonly YearMonth[];
  firstRound(): YearMonth | null;
  latestRound(): YearMonth | null;
  entryOf(round: YearMonth): RoundEntry | undefined;
  planOf(round: YearMonth): RoundEntry['plans'] | undefined;
  /** round 회차 시트에 적힌 month 실적. */
  actualOf(round: YearMonth, month: YearMonth): Amount | LedgerMissing;
};

export function emptyLedger(): ForecastLedger {
  return build(new Map());
}

/**
 * 요청 본문처럼 믿을 수 없는 회차 목록으로 이력을 만든다. 회차마다 기재분
 * 불변식을 검사하고, 같은 회차가 두 번 오면 어느 파일을 믿을지 알 수 없으므로
 * 거부한다.
 */
export function ledgerOf(raw: readonly unknown[]): ForecastLedger {
  if (!Array.isArray(raw)) throw new Error('회차 목록은 배열이어야 합니다.');
  const entries = new Map<YearMonth, RoundEntry>();
  raw.forEach((item, i) => {
    let entry: RoundEntry;
    try {
      entry = roundEntry(item);
    } catch (e) {
      throw new Error(`회차 ${i + 1}번째: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (entries.has(entry.round)) throw new Error(`${entry.round} 회차가 두 번 있습니다.`);
    entries.set(entry.round, entry);
  });
  return build(entries);
}

function build(entries: ReadonlyMap<YearMonth, RoundEntry>): ForecastLedger {
  const sorted = () => [...entries.keys()].sort(compareYearMonth);

  return {
    record(entry) {
      return build(new Map(entries).set(entry.round, entry));
    },

    rounds: sorted,
    firstRound: () => sorted()[0] ?? null,
    latestRound: () => sorted().at(-1) ?? null,

    entryOf: (round) => entries.get(round),
    planOf: (round) => entries.get(round)?.plans,

    actualOf(round, month) {
      const entry = entries.get(round);
      if (entry === undefined) {
        return { missing: `${month} 실적은 ${round} 회차에서 읽는데, 그 회차를 올리지 않았습니다.` };
      }
      // 시트가 그해 1월부터라 전년 달 열이 없다(1~3월 회차의 전년 10~12월).
      if (compareYearMonth(month, entry.sheetStart) < 0) {
        return { missing: `${round} 회차 시트는 ${entry.sheetStart}부터라 ${month} 실적 열이 없습니다.` };
      }
      return entry.actuals.find((a) => a.month === month)?.value ?? { missing: `${round} 회차에 ${month} 실적이 없습니다.` };
    },
  };
}
