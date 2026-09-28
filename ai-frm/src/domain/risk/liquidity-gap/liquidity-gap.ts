/**
 * 유동성 Gap — 지금 쥔 시재로 앞으로 3개월 순지출을 버틸 수 있는가.
 *
 *   순지출  = 3개월 지출 − 3개월 수입
 *   Gap     = 기초시재 ÷ 순지출
 *
 * 이전 구현은 순지출을 `Math.abs(수입 − 지출)`로 구해서, 수입이 지출보다 많은
 * 구간을 순유출로 뒤집었다. 그러면 수입이 늘수록 등급이 나빠진다. 순유입은
 * 예외가 아니라 결과의 한 갈래이므로 타입으로 나눠 둔다.
 *
 * 수입은 '수입'(운영) 행을 쓴다. '수입계'는 공사채·차입을 포함하는데, 조달은
 * 유동성 위험의 해결책이지 완충재가 아니다. 빌릴 계획을 시재처럼 세면
 * "빌릴 수 있으니 안전하다"는 순환이 된다.
 * 다만 '수입' 행에도 국민주택기금·정부출자금은 들어 있다 — 여기서 빠지는 것은
 * 공사채·금융기관 차입이다.
 */

import { divide, minus, sumOf, type Amount, type Ratio } from '@/domain/shared/amount';
import { gradeBy, type Grade } from '@/domain/risk/grade';
import { GRADE_WHEN_NET_INFLOW, LIQUIDITY_GAP_BANDS } from '@/domain/risk/liquidity-gap/policy';
import { windowFrom, type Month, type Statement } from '@/domain/cashflow/statement';

/** 회의록이 정한 관측 구간. */
export const LIQUIDITY_WINDOW_MONTHS = 3;

export type LiquidityGapInput = {
  /** 기준월의 기초시재. 합산하지 않는다 — 지금 쥔 잔고다. */
  readonly openingCash: Amount;
  /** 3개월 수입 합계 (운영). */
  readonly income: Amount;
  /** 3개월 지출 합계. */
  readonly expense: Amount;
};

export type LiquidityGap =
  | {
      readonly kind: 'gap';
      readonly openingCash: Amount;
      readonly income: Amount;
      readonly expense: Amount;
      readonly netOutflow: Amount;
      readonly gapRatio: Ratio;
      readonly grade: Grade;
    }
  | {
      readonly kind: 'net-inflow';
      readonly openingCash: Amount;
      readonly income: Amount;
      readonly expense: Amount;
      readonly netInflow: Amount;
      readonly grade: Grade;
    };

export function assessLiquidityGap(input: LiquidityGapInput): LiquidityGap {
  const { openingCash, income, expense } = input;
  const netOutflow = minus(expense, income);

  if (netOutflow <= 0) {
    return {
      kind: 'net-inflow',
      openingCash,
      income,
      expense,
      netInflow: minus(income, expense),
      grade: GRADE_WHEN_NET_INFLOW,
    };
  }

  const gapRatio = divide(openingCash, netOutflow);

  return {
    kind: 'gap',
    openingCash,
    income,
    expense,
    netOutflow,
    gapRatio,
    grade: gradeBy(LIQUIDITY_GAP_BANDS, gapRatio),
  };
}

/**
 * 회차에서 산식 입력을 뽑는다.
 *
 * 화면이 직접 조립하면 "기초시재는 기준월 것만, 수입·지출은 3개월 합계"라는
 * 규칙이 표현 계층으로 샌다.
 */
export function liquidityGapInputFrom(statement: Statement, base: Month): LiquidityGapInput {
  const months = windowFrom(statement, base, LIQUIDITY_WINDOW_MONTHS);

  return {
    openingCash: statement.amountOf('기초시재', base),
    income: sumOf(months.map((m) => statement.amountOf('수입', m))),
    expense: sumOf(months.map((m) => statement.amountOf('지출', m))),
  };
}
