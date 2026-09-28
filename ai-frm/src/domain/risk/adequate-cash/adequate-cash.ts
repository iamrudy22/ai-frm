/**
 * 적정 시재 (LCR 모델) — 지금 쥔 시재가 앞으로 3개월을 버틸 만큼인가.
 *
 *   적정시재 = 0.2 × 분양회수 + 0.1 × 기타수입 + 0.1 × 지출 + 0.4 × 수지차   (각 3개월 합계)
 *   수지차   = 지출 − 수입
 *   판정     = 기초시재 ≥ 적정시재 → T(안정적), 아니면 F(적정시재 부족)
 *
 * 등급이 없다. 대금 회수·유동성 Gap과 달리 구간표도 4단계도 없고 T/F뿐이다.
 *
 * 수입은 '수입' 행이다. '수입계'는 공사채·차입을 포함하는데, 자금조달은
 * 정책상 산식에서 뺐다. 적정시재는 음수가 될 수 있고(순유입이 클 때), 그대로 쓴다.
 *
 * 회차 기준월 뒤의 달은 기초시재가 계획 조달까지 들어간 이월 잔고라 '계획'으로
 * 표시한다. 창이 계획연도를 넘으면 다음 해 열은 계획이 일부만 채워져 있어서
 * 적정시재가 작게 나올 수 있으므로 따로 표시한다.
 */

import { minus, scale, sumOf, type Amount } from '@/domain/shared/amount';
import { windowFrom, type ItemName, type Month, type Statement } from '@/domain/cashflow/statement';
import { LCR_WEIGHTS, type LcrComponent } from '@/domain/risk/adequate-cash/policy';

/** 정책이 정한 관측 구간. */
export const ADEQUATE_CASH_WINDOW_MONTHS = 3;

export type AdequateCashInput = {
  /** 기준월의 기초시재(현재시재). 합산하지 않는다. */
  readonly openingCash: Amount;
  /** 3개월 합계들. */
  readonly salesRecovery: Amount;
  readonly otherIncome: Amount;
  readonly income: Amount;
  readonly expense: Amount;
};

export type AdequateCashComponent = {
  readonly key: LcrComponent;
  /** 3개월 합계. 수지차는 지출 − 수입이라 음수일 수 있다. */
  readonly total: Amount;
  readonly weight: number;
  readonly weighted: Amount;
};

export type AdequateCashAssessment = {
  readonly openingCash: Amount;
  readonly components: readonly AdequateCashComponent[];
  readonly adequateCash: Amount;
  /** 현재시재 − 적정시재. 음수면 부족분이다. */
  readonly surplus: Amount;
  readonly isAdequate: boolean;
};

export function assessAdequateCash(input: AdequateCashInput): AdequateCashAssessment {
  const { openingCash, salesRecovery, otherIncome, income, expense } = input;

  const totals: Record<LcrComponent, Amount> = {
    분양회수: salesRecovery,
    기타수입: otherIncome,
    지출: expense,
    수지차: minus(expense, income),
  };

  const components = (Object.keys(LCR_WEIGHTS) as LcrComponent[]).map((key) => ({
    key,
    total: totals[key],
    weight: LCR_WEIGHTS[key],
    weighted: scale(totals[key], LCR_WEIGHTS[key]),
  }));

  const adequateCash = sumOf(components.map((c) => c.weighted));

  return {
    openingCash,
    components,
    adequateCash,
    surplus: minus(openingCash, adequateCash),
    isAdequate: openingCash >= adequateCash,
  };
}

/**
 * 회차에서 산식 입력을 뽑는다. 창이 모자라거나 필요한 항목을 읽지 못했으면 던진다.
 * 짧은 창이나 0으로 채운 항목으로 계산하면 적정시재가 작아져 안전해 보인다.
 */
export function adequateCashInputFrom(statement: Statement, base: Month): AdequateCashInput {
  const months = windowFrom(statement, base, ADEQUATE_CASH_WINDOW_MONTHS);
  const total = (item: ItemName) => sumOf(months.map((m) => statement.amountOf(item, m)));

  return {
    openingCash: statement.amountOf('기초시재', base),
    salesRecovery: total('분양회수'),
    otherIncome: total('기타수입'),
    income: total('수입'),
    expense: total('지출'),
  };
}

export type AdequateCashMonth = AdequateCashAssessment & {
  readonly month: Month;
  /** 3개월 창의 마지막 달. */
  readonly windowEnd: Month;
  /** 회차 기준월 뒤의 달 — 기초시재가 계획상 이월 잔고다. */
  readonly isPlan: boolean;
  /** 창이 계획연도를 넘어 다음 해 열에 걸친다 — 다음 해 계획 미확정. */
  readonly beyondPlanYear: boolean;
};

export function adequateCashAt(statement: Statement, base: Month): AdequateCashMonth {
  const assessment = assessAdequateCash(adequateCashInputFrom(statement, base));
  const windowEnd = statement.months[base.index + ADEQUATE_CASH_WINDOW_MONTHS - 1];

  return {
    ...assessment,
    month: base,
    windowEnd,
    isPlan: base.index > statement.defaultBaseMonth.index,
    beyondPlanYear: windowEnd.index > statement.planYearEnd.index,
  };
}
