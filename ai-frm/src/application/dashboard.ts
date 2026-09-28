/**
 * 대시보드 유스케이스 — 두 회차로 지표들을 산출하고 진단을 모은다.
 *
 * 화면(React)에 숨어 있던 조율 규칙을 여기로 옮긴다. 화면은 표시만 한다.
 *   - 대금 회수 위험은 회차 기준월로, 유동성 Gap·적정 시재는 사용자가 고른 기준월로 셈한다
 *   - 이전 회차가 없으면 대금 회수는 산출 대상이 아니다(null)
 *   - 한 지표의 실패가 다른 지표로 번지지 않는다 — 지표마다 따로 감싼다
 *
 * 실패의 모양은 Outcome 하나다. 조립 단계에서 던진 오류와, 산식이 값으로
 * 돌려준 판정 불가(대금 회수의 'invalid')를 여기서 같은 모양으로 모은다.
 */

import {
  checkConsecutive,
  checkRollForward,
  type ConsecutiveCheck,
  type ItemName,
  type Month,
  type Statement,
} from '@/domain/cashflow/statement';
import { adequateCashAt, type AdequateCashMonth } from '@/domain/risk/adequate-cash/adequate-cash';
import {
  assessLiquidityGap,
  liquidityGapInputFrom,
  type LiquidityGap,
} from '@/domain/risk/liquidity-gap/liquidity-gap';
import {
  assessPaymentRecovery,
  paymentRecoveryInputFrom,
  type PaymentRecovery,
} from '@/domain/risk/payment-recovery/payment-recovery';

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export type PaymentRecoveryResult = Extract<PaymentRecovery, { kind: 'ok' }>;

export type Dashboard = {
  /** 이전 회차가 없으면 null — 실패가 아니라 산출 대상이 아니다. */
  readonly paymentRecovery: Outcome<PaymentRecoveryResult> | null;
  readonly liquidityGap: Outcome<LiquidityGap>;
  /** 고른 기준월 한 달치. 다음 달들의 추이는 내지 않는다. 등급이 없다. */
  readonly adequateCash: Outcome<AdequateCashMonth>;
  readonly diagnostics: {
    /** 이전 회차가 없으면 null. */
    readonly order: ConsecutiveCheck | null;
    /** 최신 회차의 시재 롤포워드. 판정을 막지 않는 신호다. */
    readonly rollForward: readonly string[];
    /** 최신 회차에서 읽지 못한 항목. */
    readonly unreadable: readonly { readonly item: ItemName; readonly reason: string }[];
  };
};

export function assessDashboard(previous: Statement | null, latest: Statement, base: Month): Dashboard {
  return {
    paymentRecovery:
      previous === null
        ? null
        : settle(() => {
            const result = assessPaymentRecovery(paymentRecoveryInputFrom(previous, latest));
            return result.kind === 'ok' ? succeed(result) : fail(result.reason);
          }, '대금 회수 위험을 산출할 수 없습니다.'),
    liquidityGap: settle(
      () => succeed(assessLiquidityGap(liquidityGapInputFrom(latest, base))),
      '유동성 Gap을 산출할 수 없습니다.',
    ),
    adequateCash: settle(() => succeed(adequateCashAt(latest, base)), '적정 시재를 산출할 수 없습니다.'),
    diagnostics: {
      order: previous === null ? null : checkConsecutive(previous, latest),
      rollForward: checkRollForward(latest),
      unreadable: latest.unreadableItems(),
    },
  };
}

function succeed<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

function fail<T>(reason: string): Outcome<T> {
  return { ok: false, reason };
}

/** 던진 오류를 실패 값으로 바꾼다. 지표 하나의 실패가 여기서 멈춘다. */
function settle<T>(run: () => Outcome<T>, fallback: string): Outcome<T> {
  try {
    return run();
  } catch (e) {
    return fail(e instanceof Error ? e.message : fallback);
  }
}
