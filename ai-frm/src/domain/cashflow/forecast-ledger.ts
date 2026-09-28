/**
 * 분양회수 계획·실적 이력 — 올린 회차마다 기재분 한 건을 담는다.
 *
 * 특정 지표의 개념이 아니라 자금수지의 사실이라 회차와 같은 곳에 둔다(DDD 검토
 * §10-2). 건설경기 인식 지수의 분양회수 예측오차가 이 이력을 읽는다.
 *
 * 단위는 **회차**다(정책 §3-3). 분양회수 예측오차(기준월 t)는 t−3월 회차의 계획과
 * t−3~t−1월 각 달의 직후 회차 실적을 쓰므로, 회차를 키로 담는다. 같은 회차를
 * 다시 올리면 그 회차의 기재분을 통째로 바꾼다. 다른 회차는 건드리지 않는다.
 *
 * m월 실적은 **m+1월 회차가 적은 값**이다(엑셀 분양회수data와 같다). 나중 회차에서
 * 정산된 값은 쓰지 않는다. 직후 회차 시트에 그 달 열이 아예 없을 때(2026년 1월
 * 회차의 2025년 12월)만, 그 달이 실적으로 들어 있는 가장 이른 회차에서 채운다.
 *
 * 저장하지 않는다(2026-09-28). 산출할 때마다 화면에서 올린 회차들로 새로 만든다
 * (ledgerOf). 이전에 올린 파일이 결과에 섞이지 않는다.
 */

import { roundEntry, type RoundEntry } from '@/domain/cashflow/round-entry';
import type { Amount } from '@/domain/shared/amount';
import { addMonths, compareYearMonth, type YearMonth } from '@/domain/shared/year-month';

/** 값이 없다는 사실과 그 사유. 0으로 대신하지 않는다. */
export type LedgerMissing = { readonly missing: string };

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
  /** month 실적 = 직후 회차(month+1)가 적은 값. 그 시트에 없는 전년 달만 다른 회차에서 채운다. */
  actualOf(month: YearMonth): Amount | LedgerMissing;
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

    actualOf(month) {
      const next = addMonths(month, 1);
      const entry = entries.get(next);
      if (entry === undefined) {
        return { missing: `${month} 실적은 직후 회차인 ${next} 회차에서 읽는데, 그 회차를 올리지 않았습니다.` };
      }
      if (compareYearMonth(month, entry.sheetStart) >= 0) {
        const cell = entry.actuals.find((a) => a.month === month);
        return cell?.value ?? { missing: `${next} 회차에 ${month} 실적이 없습니다.` };
      }

      // 직후 회차 시트에 열이 없는 전년 달 — 그 달이 실적인 가장 이른 회차에서 채운다.
      for (const r of sorted()) {
        const cell = entries.get(r)?.actuals.find((a) => a.month === month);
        if (cell !== undefined) return cell.value;
      }
      return {
        missing: `${next} 회차에는 ${month} 열이 없고, ${month}이(가) 실적인 회차도 올리지 않았습니다. 전년도 파일을 올리세요.`,
      };
    },

  };
}
