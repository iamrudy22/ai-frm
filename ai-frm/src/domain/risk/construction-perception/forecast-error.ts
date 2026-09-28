/**
 * 분양회수 예측오차 — 두 달 전 회차가 세운 3개월치 회수 계획 대비, 그 3개월
 * 동안 실제로 얼마나 걷혔는가(정책 §3-2).
 *
 *   계획(t)  = t−2월 회차가 세운 t−2, t−1, t월 계획의 합   (엑셀 M0 + M1 + M2)
 *   실적(t)  = t−2, t−1, t월 실적의 합
 *   오차율(t) = (실적(t) − 계획(t)) / 계획(t)
 *
 * 엑셀과 소수점 끝자리까지 맞추려고 더하는 순서도 엑셀과 같게 한다.
 * 엑셀은 최신 달이 위에 있어 SUM(C_t:C_{t−2})가 t, t−1, t−2 순으로 더한다.
 *
 * 이 파일은 이력을 읽기만 한다.
 */

import type { ForecastLedger } from '@/domain/cashflow/forecast-ledger';
import type { Missing } from '@/domain/risk/construction-perception/construction-perception';
import { ratio, type Ratio } from '@/domain/shared/amount';
import { addMonths, type YearMonth } from '@/domain/shared/year-month';

export function forecastErrorAt(ledger: ForecastLedger, t: YearMonth): Ratio | Missing {
  const windowMonths = [t, addMonths(t, -1), addMonths(t, -2)];

  let actual = 0;
  for (const m of windowMonths) {
    const value = ledger.actualOf(m);
    if (value === undefined) {
      return { missing: `분양회수 ${m} 실적이 이력에 없습니다(${addMonths(m, 1)} 회차 필요).` };
    }
    actual += value;
  }

  const planRound = addMonths(t, -2);
  const plan = ledger.planOf(planRound);
  if (plan === undefined) {
    return { missing: `분양회수 ${planRound} 회차의 3개월 계획이 이력에 없습니다.` };
  }
  const planned = plan[0] + plan[1] + plan[2];
  if (planned <= 0) {
    return { missing: `${planRound} 회차의 3개월 계획 합이 ${planned}이라 오차율을 낼 수 없습니다.` };
  }

  return ratio((actual - planned) / planned);
}
