/**
 * 분양회수 계획·실적 이력 — 올린 회차마다 기재분 한 건을 쌓는다(판형 2).
 *
 * 특정 지표의 개념이 아니라 자금수지의 사실이라 회차와 같은 곳에 둔다(DDD 검토
 * §10-2). 건설경기 인식 지수의 분양회수 예측오차가 이 이력을 읽는다.
 *
 * 단위는 **회차**다(정책 §3-3, 2026-09-28 개정). 분양회수 예측오차(기준월 t)는
 * t월 회차의 실적과 t−2월 회차의 계획을 쓰므로, 회차를 키로 담는다. 같은 회차를
 * 다시 올리면 그 회차의 기재분을 통째로 바꾼다. 다른 회차는 건드리지 않는다.
 *
 * 실적은 기준월 회차 한 장에서 읽는다. 그 회차 시트에 그 달 열이 아예 없을 때
 * (1~3월 회차의 전년 달)만, 그 달이 실적으로 들어 있는 가장 최근 회차에서 채운다.
 *
 * 판형 1(달 단위, 회차마다 실적 1개·계획 3개)은 새 정의에 쓸 수 없어 거부한다.
 */

import { roundEntry, type RoundEntry } from '@/domain/cashflow/round-entry';
import type { Amount } from '@/domain/shared/amount';
import { addMonths, compareYearMonth, type YearMonth } from '@/domain/shared/year-month';

/** 값이 없다는 사실과 그 사유. 0으로 대신하지 않는다. */
export type LedgerMissing = { readonly missing: string };

export type LedgerSnapshot = { readonly version: 2; readonly rounds: readonly RoundEntry[] };

export type ForecastLedger = {
  /** 유일한 변경 경로. 새 이력을 돌려준다. */
  record(entry: RoundEntry): ForecastLedger;
  rounds(): readonly YearMonth[];
  firstRound(): YearMonth | null;
  latestRound(): YearMonth | null;
  /** 첫 회차와 마지막 회차 사이에 빠진 회차. */
  missingRounds(): readonly YearMonth[];
  entryOf(round: YearMonth): RoundEntry | undefined;
  planOf(round: YearMonth): RoundEntry['plans'] | undefined;
  /** round 회차가 적은 month 실적. 그 시트에 없는 전년 달만 다른 회차에서 채운다. */
  actualFor(round: YearMonth, month: YearMonth): Amount | LedgerMissing;
  snapshot(): LedgerSnapshot;
};

export function emptyLedger(): ForecastLedger {
  return build(new Map());
}

export function ledgerFrom(snapshot: LedgerSnapshot): ForecastLedger {
  const version = (snapshot as { version?: unknown } | null)?.version;
  if (version === 1) {
    throw new Error(
      '분양회수 이력이 판형 1(달 단위)입니다. 2026-09-28 개정된 정의로는 계산할 수 없습니다. ' +
        '파일을 따로 보관하고 회차를 다시 올리세요.',
    );
  }
  if (version !== 2 || !Array.isArray(snapshot.rounds)) {
    throw new Error(`모르는 이력 판형입니다: ${String(version)}`);
  }

  const entries = new Map<YearMonth, RoundEntry>();
  for (const raw of snapshot.rounds) {
    const entry = roundEntry(raw);
    if (entries.has(entry.round)) throw new Error(`이력에 ${entry.round} 회차가 두 번 있습니다.`);
    entries.set(entry.round, entry);
  }
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

    missingRounds() {
      const all = sorted();
      if (all.length === 0) return [];
      const missing: YearMonth[] = [];
      for (let m = all[0]; compareYearMonth(m, all[all.length - 1]) < 0; m = addMonths(m, 1)) {
        if (!entries.has(m)) missing.push(m);
      }
      return missing;
    },

    entryOf: (round) => entries.get(round),
    planOf: (round) => entries.get(round)?.plans,

    actualFor(round, month) {
      const entry = entries.get(round);
      if (entry === undefined) {
        return { missing: `${round} 회차가 이력에 없습니다. 올리세요.` };
      }
      if (compareYearMonth(month, entry.sheetStart) >= 0) {
        const cell = entry.actuals.find((a) => a.month === month);
        return cell?.value ?? { missing: `${round} 회차에 ${month} 실적이 없습니다.` };
      }

      // 그 회차 시트에 열이 없는 전년 달 — 그 달이 실적인 가장 최근 회차에서 채운다.
      for (const r of [...sorted()].reverse()) {
        const cell = entries.get(r)?.actuals.find((a) => a.month === month);
        if (cell !== undefined) return cell.value;
      }
      return {
        missing: `${round} 회차에는 ${month} 열이 없고, ${month}이(가) 실적인 회차도 이력에 없습니다. 전년도 파일을 올리세요.`,
      };
    },

    snapshot: () => ({ version: 2, rounds: sorted().map((r) => entries.get(r) as RoundEntry) }),
  };
}
