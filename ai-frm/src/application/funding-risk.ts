/**
 * 유스케이스: 조달위험 인식 지수 산출 — 판단월 한 달을 채권 시가평가 금리로 판정한다.
 *
 *   판단월 결정 → 관측월이 끝났는지 확인 → 관측월 금리 조회 → 판정
 *
 * 판단월(정책 §3, 2026-09-28 확정): 최신 회차의 달 > 오늘이 속한 달. 대금 회수 위험의
 * 판단월과 같다. 관측월 = 판단월 − 1이고, 그 달의 마지막 평가일 값을 쓴다.
 *
 * 실패는 두 층이다.
 *   - 조회 실패와 값 없음은 산출불가 사유로 나온다. 던지지 않는다.
 *   - 그 밖의 예기치 못한 실패만 Outcome 실패다.
 */

import { settleAsync, succeed, type Outcome } from '@/application/outcome';
import type { BondYieldSource, YieldFetch } from '@/application/ports';
import { assessFundingRisk, observedMonthOf, type FundingRisk } from '@/domain/risk/funding-risk/funding-risk';
import { compareYearMonth, yearMonthOfDate, type YearMonth } from '@/domain/shared/year-month';

export type FundingRiskRequest = {
  /** 판단월 = 올린 최신 회차의 달. 없으면 오늘이 속한 달이다. */
  readonly judgedMonth?: YearMonth;
};

/** 판단월이 어디서 왔는가. 화면이 설명 문장을 고를 때 쓴다. */
export type JudgedMonthSource = '회차' | '오늘';

export type FundingRiskReport = {
  readonly source: JudgedMonthSource;
  readonly result: FundingRisk;
  /** 채권정보센터 응답을 받은 시각. 조회하지 않았거나 실패했으면 null. */
  readonly fetchedAt: Date | null;
};

export async function assessFundingRiskReport(
  yields: BondYieldSource,
  request: FundingRiskRequest = {},
  now: () => Date = () => new Date(),
): Promise<Outcome<FundingRiskReport>> {
  return settleAsync(async () => {
    const today = yearMonthOfDate(now());
    const judged = request.judgedMonth ?? today;
    const source: JudgedMonthSource = request.judgedMonth === undefined ? '오늘' : '회차';
    const observed = observedMonthOf(judged);
    const unavailable = (reason: string): FundingRiskReport => ({
      source,
      result: { kind: 'unavailable', judgedMonth: judged, observedMonth: observed, reason },
      fetchedAt: null,
    });

    // 달 중간의 값을 말일 값처럼 쓰지 않는다. 조회하면 오늘까지의 평가일이 오기 때문이다.
    if (compareYearMonth(observed, today) >= 0) {
      return succeed(unavailable(`아직 ${observed} 말이 지나지 않았습니다.`));
    }

    const fetched = await fetchSafely(yields, observed);
    if ('error' in fetched) return succeed(unavailable(`채권정보센터 조회 실패: ${fetched.error}`));

    return succeed({ source, result: assessFundingRisk(judged, fetched.days), fetchedAt: fetched.fetchedAt });
  }, '조달위험 인식 지수를 산출하지 못했습니다.');
}

/** 조회가 던져도 조회 실패로 바꿔 이어 간다. */
async function fetchSafely(yields: BondYieldSource, month: YearMonth): Promise<YieldFetch> {
  try {
    return await yields.dailyYields(month);
  } catch (e) {
    return { error: e instanceof Error ? e.message : '알 수 없는 오류입니다.' };
  }
}
