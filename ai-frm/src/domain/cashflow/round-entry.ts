/**
 * 회차 기재분 — 한 회차에서 분양회수 계획·실적 이력으로 떼어 가는 몫.
 *
 * 기준월 b인 회차에서 두 가지를 뗀다(정책 §3-3).
 *   - b−1월 분양회수 실적 1개
 *   - b, b+1, b+2월 분양회수 계획 3개 (엑셀 분양회수data의 M0·M1·M2)
 *
 * 과거 계획은 최신 회차에 남아 있지 않다. 회차가 지나면 그 달 열이 실적으로
 * 덮이기 때문이다. 그래서 매달 이만큼만 떼어 이력에 쌓는다.
 *
 * 브라우저에서 회차를 읽어 만들든(roundEntryOf) 서버가 요청 본문으로 받든
 * (roundEntry) 같은 불변식을 지난다. 자금수지표 원본은 서버로 가지 않고 이
 * 네 값만 간다.
 */

import { calendarOf, type Statement } from '@/domain/cashflow/statement';
import { amount, type Amount } from '@/domain/shared/amount';
import { addMonths, parseYearMonth, type YearMonth } from '@/domain/shared/year-month';

export type RoundEntry = {
  /** 회차 = 기준월 b. */
  readonly round: YearMonth;
  /**
   * b−1월 실적. 1월 회차는 시트가 계획연도 1월부터라 전년 12월 열이 없다.
   * 그때는 값 대신 사유를 남긴다(구현 계획 R7). 0으로 채우지 않는다.
   */
  readonly actual:
    | { readonly month: YearMonth; readonly value: Amount }
    | { readonly month: YearMonth; readonly missing: string };
  readonly plan: {
    readonly month: YearMonth;
    readonly values: readonly [Amount, Amount, Amount];
    /** 계획 3개 중 계획연도 끝을 넘는 칸이 있다(11·12월 회차). 그 열은 일부만 채워져 있다. */
    readonly beyondPlanYear: boolean;
  };
};

const PLAN_MONTHS = 3;

export function roundEntryOf(statement: Statement): RoundEntry {
  const base = statement.defaultBaseMonth;
  const round = calendarOf(statement, base);

  const planMonths = statement.months.slice(base.index, base.index + PLAN_MONTHS);
  if (planMonths.length < PLAN_MONTHS) {
    throw new Error(`${base.label}부터 계획 3개월을 뗄 수 없습니다. 시트에 ${planMonths.length}개월뿐입니다.`);
  }
  const [m0, m1, m2] = planMonths.map((m) => statement.amountOf('분양회수', m));

  const prev = statement.months[base.index - 1];
  const actualMonth = addMonths(round, -1);
  const actual: RoundEntry['actual'] =
    prev === undefined
      ? {
          month: actualMonth,
          missing: `${base.label} 회차에는 직전 월(${actualMonth}) 열이 없어 12월 실적을 뗄 수 없습니다.`,
        }
      : { month: actualMonth, value: statement.amountOf('분양회수', prev) };

  return {
    round,
    actual,
    plan: {
      month: round,
      values: [m0, m1, m2],
      beyondPlanYear: base.index + PLAN_MONTHS - 1 > statement.planYearEnd.index,
    },
  };
}

/** 요청 본문처럼 믿을 수 없는 값을 검사해 기재분으로 만든다. */
export function roundEntry(raw: unknown): RoundEntry {
  const body = object(raw, '본문');
  const round = parseYearMonth(string(body.round, 'round'));

  const a = object(body.actual, 'actual');
  const actualMonth = parseYearMonth(string(a.month, 'actual.month'));
  if (actualMonth !== addMonths(round, -1)) {
    throw new Error(`실적 달(${actualMonth})은 회차(${round})의 직전 달이어야 합니다.`);
  }
  const actual: RoundEntry['actual'] =
    'missing' in a
      ? { month: actualMonth, missing: string(a.missing, 'actual.missing') }
      : { month: actualMonth, value: money(a.value, 'actual.value') };

  const p = object(body.plan, 'plan');
  const planMonth = parseYearMonth(string(p.month, 'plan.month'));
  if (planMonth !== round) {
    throw new Error(`계획 달(${planMonth})은 회차(${round})와 같아야 합니다.`);
  }
  if (!Array.isArray(p.values) || p.values.length !== PLAN_MONTHS) {
    throw new Error('계획은 세 칸이어야 합니다.');
  }
  const [m0, m1, m2] = p.values.map((v, i) => money(v, `plan.values[${i}]`));
  if (typeof p.beyondPlanYear !== 'boolean') {
    throw new Error('plan.beyondPlanYear는 참/거짓이어야 합니다.');
  }

  return { round, actual, plan: { month: planMonth, values: [m0, m1, m2], beyondPlanYear: p.beyondPlanYear } };
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
