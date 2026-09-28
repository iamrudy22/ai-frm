/**
 * 분양회수 예측오차 — 자금기획팀 정의(정책 §3-2, 2026-09-28 개정).
 *
 *   실적      = t월 회차의 (t−3, t−2, t−1)월 실적 합
 *   분자 계획  = t−2월 회차의 (t−1, t, t+1)월 계획 합
 *   분모 계획  = t−2월 회차의 (t−2, t−1, t)월 계획 합
 *   오차율    = (실적 − 분자 계획) ÷ 분모 계획
 *
 * 7월이면 (7월 회차의 4·5·6월 실적 − 5월 회차의 6·7·8월 계획) ÷ 5월 회차의
 * 5·6·7월 계획이다. 분자와 분모의 계획 창이 다른 것도 확인된 정의다 — 그래서
 * 매달 계획대로 걷혀도 0이 아닐 수 있다. 엑셀 분양회수data와는 다른 값이 나온다.
 *
 * 이 파일은 이력을 읽기만 한다.
 */

import type { ForecastLedger } from '@/domain/cashflow/forecast-ledger';
import type { Missing } from '@/domain/risk/construction-perception/construction-perception';
import { ratio, type Ratio } from '@/domain/shared/amount';
import { addMonths, type YearMonth } from '@/domain/shared/year-month';

export function forecastErrorAt(ledger: ForecastLedger, t: YearMonth): Ratio | Missing {
  if (ledger.entryOf(t) === undefined) {
    return { missing: `분양회수: ${t} 회차가 이력에 없습니다. 올리세요.` };
  }
  const planRound = addMonths(t, -2);
  const plans = ledger.planOf(planRound);
  if (plans === undefined) {
    return { missing: `분양회수: ${planRound} 회차가 이력에 없습니다. 올리세요.` };
  }

  let actual = 0;
  for (const month of [addMonths(t, -3), addMonths(t, -2), addMonths(t, -1)]) {
    const value = ledger.actualFor(t, month);
    if (typeof value !== 'number') return { missing: `분양회수: ${value.missing}` };
    actual += value;
  }

  // plans = [t−2, t−1, t, t+1]월 계획
  const values: number[] = [];
  for (const cell of plans) {
    if ('missing' in cell) return { missing: `분양회수: ${cell.missing}` };
    values.push(cell.value);
  }
  const numerator = values[1] + values[2] + values[3];
  const denominator = values[0] + values[1] + values[2];
  if (denominator <= 0) {
    return { missing: `분양회수: ${planRound} 회차의 분모 계획 합이 ${denominator}이라 오차율을 낼 수 없습니다.` };
  }

  return ratio((actual - numerator) / denominator);
}
