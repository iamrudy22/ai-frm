/**
 * 분양회수 계획·실적 이력 — 회차들이 적은 분양회수 계획과 실적을 달별로 쌓는다.
 *
 * 특정 지표의 개념이 아니라 자금수지의 사실이라 회차와 같은 곳에 둔다(DDD 검토
 * §10-2). 건설경기 인식 지수의 분양회수 예측오차가 이 이력을 읽는다.
 *
 * 불변식 (정책 §3-3)
 *   - 칸마다 주인 회차가 하나다. u월 실적은 u+1월 회차, u월 계획은 u월 회차가 쓴다.
 *   - 그래서 나중 회차는 과거 실적을 덮지 않는다. 실적은 각 달 직후 회차의 값으로
 *     고정된다. 나중에 정산된 실적은 그 시점에 없던 정보라 쓰지 않는다.
 *   - 같은 회차를 다시 반영하면 그 칸을 덮는다(멱등).
 *
 * 회차 기재분(RoundEntry)은 정의상 제 칸만 가리키므로 record는 불변식을 따로
 * 검사하지 않아도 된다. 바깥에서 들어오는 스냅샷(ledgerFrom)만 검사한다 —
 * 파일을 손으로 고쳐도 불변식이 깨진 이력은 만들어지지 않는다.
 */

import type { RoundEntry } from '@/domain/cashflow/round-entry';
import { amount, type Amount } from '@/domain/shared/amount';
import { addMonths, compareYearMonth, parseYearMonth, type YearMonth } from '@/domain/shared/year-month';

type Plan = readonly [Amount, Amount, Amount];

/** 저장용 한 줄. JSON으로 그대로 오간다. */
export type LedgerRow = {
  readonly month: YearMonth;
  readonly actual?: Amount;
  /** 실적을 적은 회차. 늘 month + 1이다. */
  readonly actualFrom?: YearMonth;
  /** 엑셀에서 옮긴 값이면 true. 주인 회차가 올라오면 사라진다. */
  readonly actualSeeded?: true;
  readonly plan?: Plan;
  /** 계획을 세운 회차. 늘 month다. */
  readonly planFrom?: YearMonth;
  readonly planSeeded?: true;
  readonly planBeyondPlanYear?: true;
};

export type LedgerSnapshot = { readonly version: 1; readonly rows: readonly LedgerRow[] };

export type ForecastLedger = {
  /** 유일한 변경 경로. 새 이력을 돌려준다. */
  record(entry: RoundEntry): ForecastLedger;
  actualOf(month: YearMonth): Amount | undefined;
  planOf(month: YearMonth): Plan | undefined;
  /** 실적이 있는 가장 최근 달. 건설경기 인식 지수에서 분양회수의 최신월이다. */
  latestActualMonth(): YearMonth | null;
  /** 계획이 있는 가장 이른 달. 이 달 + 2부터 오차율을 낼 수 있다. */
  firstPlanMonth(): YearMonth | null;
  /** 가장 이른 계획 달부터 최신 실적 달까지, 실적이나 계획이 빈 달. */
  gaps(): readonly YearMonth[];
  snapshot(): LedgerSnapshot;
};

export function emptyLedger(): ForecastLedger {
  return build(new Map());
}

export function ledgerFrom(snapshot: LedgerSnapshot): ForecastLedger {
  if (typeof snapshot !== 'object' || snapshot === null || snapshot.version !== 1) {
    throw new Error(`모르는 이력 판형입니다: ${String((snapshot as { version?: unknown } | null)?.version)}`);
  }
  if (!Array.isArray(snapshot.rows)) {
    throw new Error('이력의 rows가 배열이 아닙니다.');
  }

  const rows = new Map<YearMonth, LedgerRow>();
  for (const raw of snapshot.rows) {
    const row = checkRow(raw);
    if (rows.has(row.month)) {
      throw new Error(`이력에 ${row.month}이(가) 두 번 있습니다.`);
    }
    rows.set(row.month, row);
  }
  return build(rows);
}

function checkRow(raw: LedgerRow): LedgerRow {
  const month = parseYearMonth(String(raw.month));
  const row: { -readonly [K in keyof LedgerRow]: LedgerRow[K] } = { month };

  if (raw.actual !== undefined || raw.actualFrom !== undefined) {
    if (typeof raw.actual !== 'number') throw new Error(`${month} 실적이 수가 아닙니다.`);
    const from = parseYearMonth(String(raw.actualFrom));
    if (from !== addMonths(month, 1)) {
      throw new Error(`${month} 실적의 주인 회차는 ${addMonths(month, 1)}여야 하는데 ${from}입니다.`);
    }
    row.actual = amount(raw.actual);
    row.actualFrom = from;
    if (raw.actualSeeded === true) row.actualSeeded = true;
  }

  if (raw.plan !== undefined || raw.planFrom !== undefined) {
    if (!Array.isArray(raw.plan) || raw.plan.length !== 3 || raw.plan.some((v) => typeof v !== 'number')) {
      throw new Error(`${month} 계획은 수 세 칸이어야 합니다.`);
    }
    const from = parseYearMonth(String(raw.planFrom));
    if (from !== month) {
      throw new Error(`${month} 계획의 주인 회차는 ${month}여야 하는데 ${from}입니다.`);
    }
    row.plan = [amount(raw.plan[0]), amount(raw.plan[1]), amount(raw.plan[2])];
    row.planFrom = from;
    if (raw.planSeeded === true) row.planSeeded = true;
    if (raw.planBeyondPlanYear === true) row.planBeyondPlanYear = true;
  }

  return row;
}

function build(rows: ReadonlyMap<YearMonth, LedgerRow>): ForecastLedger {
  const sorted = () => [...rows.values()].sort((a, b) => compareYearMonth(a.month, b.month));

  return {
    record(entry) {
      const next = new Map(rows);

      if ('value' in entry.actual) {
        const { month, value } = entry.actual;
        next.set(month, withoutUndefined({
          ...strip(next.get(month), 'actual'),
          month,
          actual: value,
          actualFrom: entry.round,
        }));
      }

      const { month, values, beyondPlanYear } = entry.plan;
      next.set(month, withoutUndefined({
        ...strip(next.get(month), 'plan'),
        month,
        plan: values,
        planFrom: entry.round,
        planBeyondPlanYear: beyondPlanYear ? true : undefined,
      }));

      return build(next);
    },

    actualOf: (month) => rows.get(month)?.actual,
    planOf: (month) => rows.get(month)?.plan,

    latestActualMonth() {
      const withActual = sorted().filter((r) => r.actual !== undefined);
      return withActual.length === 0 ? null : withActual[withActual.length - 1].month;
    },

    firstPlanMonth() {
      return sorted().find((r) => r.plan !== undefined)?.month ?? null;
    },

    gaps() {
      const firstPlan = this.firstPlanMonth();
      const last = this.latestActualMonth();
      if (firstPlan === null || last === null) return [];

      const gaps: YearMonth[] = [];
      for (let m = firstPlan; compareYearMonth(m, last) <= 0; m = addMonths(m, 1)) {
        const row = rows.get(m);
        if (row?.actual === undefined || row.plan === undefined) gaps.push(m);
      }
      return gaps;
    },

    snapshot: () => ({ version: 1, rows: sorted() }),
  };
}

/** 한쪽 칸(실적 또는 계획)을 새로 쓰기 전에 그 칸의 옛 값과 표시를 걷어 낸다. */
function strip(row: LedgerRow | undefined, side: 'actual' | 'plan'): Partial<LedgerRow> {
  if (row === undefined) return {};
  const copy: Record<string, unknown> = { ...row };
  const keys = side === 'actual' ? ACTUAL_KEYS : PLAN_KEYS;
  for (const key of keys) delete copy[key];
  return copy as Partial<LedgerRow>;
}

const ACTUAL_KEYS = ['actual', 'actualFrom', 'actualSeeded'] as const;
const PLAN_KEYS = ['plan', 'planFrom', 'planSeeded', 'planBeyondPlanYear'] as const;

/** 스냅샷이 JSON 왕복 뒤에도 같게 보이도록 undefined 칸을 남기지 않는다. */
function withoutUndefined(row: Record<string, unknown>): LedgerRow {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as LedgerRow;
}
