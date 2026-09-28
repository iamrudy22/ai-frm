/**
 * 대금 회수 위험 — 계획한 만큼 실제로 걷혔는가.
 *
 *   회수율 = 실적 ÷ 계획
 *
 * 같은 달을 두 회차에서 읽는다. 7월 회차의 7월 값은 계획이고, 8월 회차의
 * 7월 값은 이미 실적으로 채워져 있다. 따라서 판정 대상월은 최신 회차의
 * 직전 월이며, 그것은 곧 이전 회차의 기준월이다.
 *
 * 읽는 항목은 '분양회수'다. '수입'은 분양회수에 국고보조금·국민주택기금·
 * 정부출자금·기타수입까지 더한 합이라, 대금을 계획대로 걷었는지를 보려는
 * 이 지표에는 걷는 일과 무관한 돈이 섞여 들어간다.
 */

import { divide, type Amount, type Ratio } from '@/domain/shared/amount';
import { gradeBy, type Grade } from '@/domain/risk/grade';
import { PAYMENT_RECOVERY_BANDS } from '@/domain/risk/policy';
import { checkConsecutive, type Statement } from '@/domain/cashflow/statement';

export type PaymentRecoveryInput = {
  readonly plan: Amount;
  readonly actual: Amount;
  /** 어느 달을 판정했는지. 계산에는 쓰이지 않고 결과에 실려 나간다. */
  readonly targetMonthLabel?: string;
};

export type PaymentRecovery =
  | {
      readonly kind: 'ok';
      readonly plan: Amount;
      readonly actual: Amount;
      readonly rate: Ratio;
      readonly grade: Grade;
      readonly targetMonthLabel?: string;
    }
  | { readonly kind: 'invalid'; readonly reason: string };

export function assessPaymentRecovery(input: PaymentRecoveryInput): PaymentRecovery {
  const { plan, actual, targetMonthLabel } = input;

  // 0이면 나눌 수 없고, 음수면 부호가 뒤집혀 미달이 초과처럼 보인다.
  if (plan <= 0) {
    return {
      kind: 'invalid',
      reason: `계획값이 ${plan}이어서 회수율을 낼 수 없습니다.`,
    };
  }

  const rate = divide(actual, plan);

  return {
    kind: 'ok',
    plan,
    actual,
    rate,
    grade: gradeBy(PAYMENT_RECOVERY_BANDS, rate),
    targetMonthLabel,
  };
}

export function paymentRecoveryInputFrom(prev: Statement, next: Statement): PaymentRecoveryInput {
  const targetInNext = next.months[next.defaultBaseMonth.index - 1];

  if (targetInNext === undefined) {
    throw new Error(
      `최신 회차의 기준월(${next.defaultBaseMonth.label})에 직전 월이 없어 판정 대상월을 정할 수 없습니다.`,
    );
  }

  // 두 회차가 같은 달을 가리킬 때만 실적 ÷ 계획이 회수율이다. 다른 달끼리의
  // 비율은 그럴듯한 숫자로 나오므로, 경고로 넘기지 않고 조립 단계에서 멈춘다.
  // 달력(기준일)과 열(라벨)을 모두 본다 — 라벨만 보면 1년 떨어진 회차가 통과한다.
  const order = checkConsecutive(prev, next);
  if (!order.ok) {
    throw new Error(`대금 회수 위험은 연속한 두 회차로만 판정합니다. ${order.reason}`);
  }

  const targetInPrev = prev.defaultBaseMonth;

  if (targetInPrev.label !== targetInNext.label) {
    throw new Error(
      `비교할 두 값이 같은 달이 아닙니다: 이전 회차의 기준월은 ${targetInPrev.label}, 최신 회차의 직전 월은 ${targetInNext.label}입니다.`,
    );
  }

  return {
    plan: prev.amountOf('분양회수', targetInPrev),
    actual: next.amountOf('분양회수', targetInNext),
    targetMonthLabel: targetInNext.label,
  };
}
