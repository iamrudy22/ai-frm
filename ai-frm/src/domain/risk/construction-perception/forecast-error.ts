/**
 * 분양회수 예측오차 — 엑셀 분양회수data와 같은 정의(정책 §3-2, 2026-09-28 재개정).
 *
 *   실적   = (t−3, t−2, t−1)월 실적 합 — 각 달의 직후 회차 값(m월 실적은 m+1월 회차)
 *   계획   = t−3월 회차의 (t−3, t−2, t−1)월 계획 합 (엑셀의 M0 + M1 + M2)
 *   오차율 = (실적 − 계획) ÷ 계획
 *
 * 7월이면 (4·5·6월 실적 − 4월 회차 4·5·6월 계획) ÷ 같은 계획 = 엑셀 "2026/07" 행이다.
 * "7월 오차율"은 7월 기준월에 쓴다(자금기획팀 결정). 필요한 회차는 t−3 ~ t월 네 개다.
 *
 * 이 파일은 이력을 읽기만 한다.
 */

import type { ForecastLedger } from '@/domain/cashflow/forecast-ledger';
import type { Missing } from '@/domain/risk/construction-perception/construction-perception';
import { ratio, type Ratio } from '@/domain/shared/amount';
import { addMonths, type YearMonth } from '@/domain/shared/year-month';

/** 기준월 t의 계획은 t−3월 회차가 세웠다. 필요한 회차는 t−3 ~ t월. */
export const PLAN_ROUND_LAG = 3;

export function forecastErrorAt(ledger: ForecastLedger, t: YearMonth): Ratio | Missing {
  const planRound = addMonths(t, -PLAN_ROUND_LAG);
  const plans = ledger.planOf(planRound);
  if (plans === undefined) {
    return { missing: `분양회수: 계획을 세운 ${planRound} 회차가 이력에 없습니다. 올리세요.` };
  }

  let actual = 0;
  let planned = 0;
  // plans[0..2] = (t−3, t−2, t−1)월 계획. 넷째 칸은 쓰지 않는다.
  for (let i = 0; i < PLAN_ROUND_LAG; i++) {
    const cell = plans[i];
    if ('missing' in cell) return { missing: `분양회수: ${cell.missing}` };
    planned += cell.value;

    const value = ledger.actualOf(addMonths(planRound, i));
    if (typeof value !== 'number') return { missing: `분양회수: ${value.missing}` };
    actual += value;
  }

  if (planned <= 0) {
    return { missing: `분양회수: ${planRound} 회차의 3개월 계획 합이 ${planned}이라 오차율을 낼 수 없습니다.` };
  }
  return ratio((actual - planned) / planned);
}
