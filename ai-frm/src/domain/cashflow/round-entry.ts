/**
 * 회차 기재분 — 한 회차에서 분양회수 계획·실적 이력으로 떼어 가는 몫(판형 2).
 *
 * 기준월 b인 회차에서 떼어 두는 것(정책 §3-3, 2026-09-28 개정):
 *   - 그 시트에서 실적인 달 전부 — 시트 첫 달(계획연도 1월) ~ b−1월
 *   - b, b+1, b+2, b+3월 계획 4개
 *
 * 분양회수 예측오차(라벨 t)는 t월 회차의 t−3~t−1월 실적과 t−3월 회차의
 * t−3~t−1월 계획(넷째 칸은 판형 호환용)을 쓴다. 1~3월 회차에는 전년 달 열이
 * 없어서 전년 달 실적은 결측이다(forecast-ledger.ts).
 *
 * 브라우저에서 회차를 읽어 만들든(roundEntryOf) 서버가 요청 본문으로 받든
 * (roundEntry) 같은 불변식을 지난다. 자금수지표 원본은 서버로 가지 않는다.
 */

import { calendarOf, type Statement } from '@/domain/cashflow/statement';
import { amount, type Amount } from '@/domain/shared/amount';
import { addMonths, compareYearMonth, parseYearMonth, type YearMonth } from '@/domain/shared/year-month';

export type ActualCell = { readonly month: YearMonth; readonly value: Amount };

export type PlanCell =
  | {
      readonly month: YearMonth;
      readonly value: Amount;
      /** 계획연도 끝을 넘는 칸(다음 해 열). 그 열은 일부만 채워져 있다. */
      readonly beyondPlanYear?: true;
    }
  | { readonly month: YearMonth; readonly missing: string };

export type RoundEntry = {
  /** 회차 = 기준월 b. */
  readonly round: YearMonth;
  /** 시트가 시작하는 달. 이보다 앞선 달은 이 회차에 열이 없다(전년 달). */
  readonly sheetStart: YearMonth;
  /** sheetStart ~ b−1월 실적. 1월 회차면 비어 있다. */
  readonly actuals: readonly ActualCell[];
  /** b ~ b+3월 계획. */
  readonly plans: readonly [PlanCell, PlanCell, PlanCell, PlanCell];
};

export const PLAN_MONTHS = 4;

export function roundEntryOf(statement: Statement): RoundEntry {
  const base = statement.defaultBaseMonth;
  const round = calendarOf(statement, base);
  const sheetStart = calendarOf(statement, statement.months[0]);

  const actuals = statement.months
    .slice(0, base.index)
    .map((m) => ({ month: calendarOf(statement, m), value: statement.amountOf('분양회수', m) }));

  const plans = Array.from({ length: PLAN_MONTHS }, (_, i): PlanCell => {
    const month = addMonths(round, i);
    const column = statement.months[base.index + i];
    if (column === undefined) {
      return { month, missing: `${round} 회차 시트에 ${month} 열이 없습니다.` };
    }
    const value = statement.amountOf('분양회수', column);
    return column.index > statement.planYearEnd.index ? { month, value, beyondPlanYear: true } : { month, value };
  }) as unknown as RoundEntry['plans'];

  return { round, sheetStart, actuals, plans };
}

/** 요청 본문처럼 믿을 수 없는 값을 검사해 기재분으로 만든다. */
export function roundEntry(raw: unknown): RoundEntry {
  const body = object(raw, '본문');
  const round = parseYearMonth(string(body.round, 'round'));
  const sheetStart = parseYearMonth(string(body.sheetStart, 'sheetStart'));
  if (compareYearMonth(sheetStart, round) > 0) {
    throw new Error(`시트 첫 달(${sheetStart})이 회차(${round})보다 뒤입니다.`);
  }

  if (!Array.isArray(body.actuals)) throw new Error('actuals는 배열이어야 합니다.');
  const actuals = body.actuals.map((raw, i): ActualCell => {
    const cell = object(raw, `actuals[${i}]`);
    const month = parseYearMonth(string(cell.month, `actuals[${i}].month`));
    const expected = addMonths(sheetStart, i);
    if (month !== expected) throw new Error(`실적 ${i}번째 달은 ${expected}여야 하는데 ${month}입니다.`);
    return { month, value: money(cell.value, `actuals[${i}].value`) };
  });
  const lastActual = actuals.at(-1)?.month ?? addMonths(sheetStart, -1);
  if (lastActual !== addMonths(round, -1)) {
    throw new Error(`실적은 시트 첫 달부터 회차 직전 달(${addMonths(round, -1)})까지여야 합니다.`);
  }

  if (!Array.isArray(body.plans) || body.plans.length !== PLAN_MONTHS) {
    throw new Error(`계획은 ${PLAN_MONTHS}칸이어야 합니다.`);
  }
  const plans = body.plans.map((raw, i): PlanCell => {
    const cell = object(raw, `plans[${i}]`);
    const month = parseYearMonth(string(cell.month, `plans[${i}].month`));
    const expected = addMonths(round, i);
    if (month !== expected) throw new Error(`계획 ${i}번째 달은 ${expected}여야 하는데 ${month}입니다.`);
    if ('missing' in cell) return { month, missing: string(cell.missing, `plans[${i}].missing`) };
    const value = money(cell.value, `plans[${i}].value`);
    return cell.beyondPlanYear === true ? { month, value, beyondPlanYear: true } : { month, value };
  }) as unknown as RoundEntry['plans'];

  return { round, sheetStart, actuals, plans };
}

function object(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`${what}은(는) 객체여야 합니다.`);
  }
  return v as Record<string, unknown>;
}

function string(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new Error(`${what}은(는) 문자열이어야 합니다.`);
  return v;
}

function money(v: unknown, what: string): Amount {
  if (typeof v !== 'number') throw new Error(`${what}은(는) 수여야 합니다.`);
  return amount(v);
}
