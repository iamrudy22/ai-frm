/**
 * 분양회수 예측오차 — 엑셀 분양회수data와 같은 정의(정책 §3-2, 2026-09-28 재개정).
 *
 *   실적   = (t−3, t−2, t−1)월 실적 합 — 각 달의 직후 회차 값(m월 실적은 m+1월 회차)
 *   계획   = t−3월 회차의 (t−3, t−2, t−1)월 계획 합 (엑셀의 M0 + M1 + M2)
 *   오차율 = (실적 − 계획) ÷ 계획
 *
 * 7월이면 (4·5·6월 실적 − 4월 회차 4·5·6월 계획) ÷ 같은 계획 = 엑셀 "2026/07" 행이다.
 * 라벨 t는 엑셀 분양회수data의 행 라벨이다(실적이 t−1에서 끝난다). 필요한 회차는 t−3 ~ t월.
 *
 * 기준월 b의 지수에는 b+2 행을 쓴다(forecastErrorForBaseMonth, 2026-09-28 결정).
 * N월 기준(최신 회차 N, 기준월 N−2)이면 "N" 행 — N월 회차까지 올린 파일로 계산되는
 * 가장 최근 행이다. 8월 기준이면 5월 회차 5·6·7월 계획 vs 5·6·7월 실적(각 달 직후
 * 회차) = "2026/08" 행. 엑셀 재무위기인식지수_위기단계는 기준월 b에 b+1 행을 써서
 * 한 달 다르다(정책 §3-2).
 *
 * 이 파일은 이력을 읽기만 한다.
 */

import type { ForecastLedger } from '@/domain/cashflow/forecast-ledger';
import type { Missing } from '@/domain/risk/construction-perception/construction-perception';
import { ratio, type Ratio } from '@/domain/shared/amount';
import { addMonths, type YearMonth } from '@/domain/shared/year-month';

/** 라벨 t의 계획은 t−3월 회차가 세웠다. 필요한 회차는 t−3 ~ t월. */
export const PLAN_ROUND_LAG = 3;

/** 기준월 b의 지수에 쓰는 행 = b + 이 개월 수. 최신 회차(b+2)까지로 계산되는 행이다. */
export const ERROR_LABEL_LEAD = 2;

/** 기준월 b의 지수에 쓰는 오차율 — 실적 b−1 ~ b+1, 계획은 b−1월 회차(엑셀 b+2 행). */
export function forecastErrorForBaseMonth(ledger: ForecastLedger, baseMonth: YearMonth): Ratio | Missing {
  return forecastErrorAt(ledger, addMonths(baseMonth, ERROR_LABEL_LEAD));
}

/** 기준월 b의 지수에 필요한 회차 — 계획 회차 b−1부터 마지막 실적의 직후 회차 b+2까지. */
export function roundsNeededFor(baseMonth: YearMonth): YearMonth[] {
  const label = addMonths(baseMonth, ERROR_LABEL_LEAD);
  return Array.from({ length: PLAN_ROUND_LAG + 1 }, (_, i) => addMonths(label, i - PLAN_ROUND_LAG));
}

export function forecastErrorAt(ledger: ForecastLedger, t: YearMonth): Ratio | Missing {
  const planRound = addMonths(t, -PLAN_ROUND_LAG);
  const plans = ledger.planOf(planRound);
  if (plans === undefined) {
    return { missing: `분양회수: 계획을 세운 ${planRound} 회차를 올리지 않았습니다.` };
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
