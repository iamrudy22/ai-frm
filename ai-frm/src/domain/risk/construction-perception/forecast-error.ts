/**
 * 분양회수 예측오차 — 엑셀 분양회수data G·H열의 식(정책 §3-2, 2026-09-28 재개정).
 *
 *   실적   = t월 회차에 적힌 (t−3, t−2, t−1)월 실적 합
 *   계획   = t−3월 회차의 (t−3, t−2, t−1)월 계획 합 (엑셀의 M0 + M1 + M2)
 *   오차율 = (실적 − 계획) ÷ 계획
 *
 * 8월이면 (8월 회차의 5·6·7월 실적 − 5월 회차의 5·6·7월 계획) ÷ 같은 계획이다.
 * 라벨 t는 엑셀 분양회수data의 행 라벨과 같은 창이다(실적이 t−1에서 끝난다).
 * 필요한 회차는 t−3월(계획)과 t월(실적) 두 개다.
 *
 * 엑셀과 값이 조금 다를 수 있다. 엑셀 C열은 각 달 실적을 그 달 직후 회차에서 적어 두고
 * 고치지 않지만, 여기서는 t월 회차 한 장에 적힌(뒤에 고쳐진) 값을 쓴다(자금기획팀 확인).
 *
 * 기준월 b의 지수에는 b+2 행을 쓴다(forecastErrorForBaseMonth, 2026-09-28 결정).
 * N월 기준(최신 회차 N, 기준월 N−2)이면 N월 회차의 실적과 N−3월 회차의 계획이다.
 * 엑셀 재무위기인식지수_위기단계는 기준월 b에 b+1 행을 써서 한 달 다르다(정책 §3-2).
 *
 * 이 파일은 이력을 읽기만 한다.
 */

import type { ForecastLedger } from '@/domain/cashflow/forecast-ledger';
import type { Missing } from '@/domain/risk/construction-perception/construction-perception';
import { ratio, type Ratio } from '@/domain/shared/amount';
import { addMonths, type YearMonth } from '@/domain/shared/year-month';

/** 라벨 t의 계획은 t−3월 회차가 세웠다. */
export const PLAN_ROUND_LAG = 3;

/** 기준월 b의 지수에 쓰는 행 = b + 이 개월 수. 최신 회차(b+2)의 실적으로 계산되는 행이다. */
export const ERROR_LABEL_LEAD = 2;

/** 오차율 하나에 필요한 회차 — 계획을 세운 회차와 실적을 읽는 회차. */
export type NeededRounds = { readonly plan: YearMonth; readonly actual: YearMonth };

/** 기준월 b의 지수에 쓰는 오차율 — b+2월 회차의 b−1 ~ b+1월 실적 vs b−1월 회차 계획. */
export function forecastErrorForBaseMonth(ledger: ForecastLedger, baseMonth: YearMonth): Ratio | Missing {
  return forecastErrorAt(ledger, addMonths(baseMonth, ERROR_LABEL_LEAD));
}

/** 기준월 b의 지수에 필요한 회차 — 계획 b−1월, 실적 b+2월. */
export function roundsNeededFor(baseMonth: YearMonth): NeededRounds {
  return roundsNeededAt(addMonths(baseMonth, ERROR_LABEL_LEAD));
}

function roundsNeededAt(t: YearMonth): NeededRounds {
  return { plan: addMonths(t, -PLAN_ROUND_LAG), actual: t };
}

export function forecastErrorAt(ledger: ForecastLedger, t: YearMonth): Ratio | Missing {
  const { plan: planRound, actual: actualRound } = roundsNeededAt(t);
  const plans = ledger.planOf(planRound);
  const hasActuals = ledger.entryOf(actualRound) !== undefined;
  if (plans === undefined || !hasActuals) {
    const absent = [
      ...(plans === undefined ? [`계획을 세운 ${planRound} 회차`] : []),
      ...(hasActuals ? [] : [`실적을 읽는 ${actualRound} 회차`]),
    ];
    return { missing: `분양회수: ${absent.join('와 ')}를 올리지 않았습니다.` };
  }

  let actual = 0;
  let planned = 0;
  // plans[0..2] = (t−3, t−2, t−1)월 계획. 넷째 칸은 쓰지 않는다.
  for (let i = 0; i < PLAN_ROUND_LAG; i++) {
    const cell = plans[i];
    if ('missing' in cell) return { missing: `분양회수: ${cell.missing}` };
    planned += cell.value;

    const value = ledger.actualOf(actualRound, cell.month);
    if (typeof value !== 'number') return { missing: `분양회수: ${value.missing}` };
    actual += value;
  }

  if (planned <= 0) {
    return { missing: `분양회수: ${planRound} 회차의 3개월 계획 합이 ${planned}이라 오차율을 낼 수 없습니다.` };
  }
  return ratio((actual - planned) / planned);
}
