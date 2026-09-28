/**
 * 조달위험 인식 지수 — 공사채를 찍어 돈을 빌리는 값이 무위험 금리보다 얼마나 비싼가.
 *
 *   금리 차이 = 공사채 AAA 1년 − 국고채 1년   (둘 다 3사 평균, 관측월 마지막 평가일)
 *
 * 판단월 J에는 J−1월(관측월)의 마지막 평가일 값을 쓴다. 8월 판단이면 7/31이다.
 * 말일이 주말·휴일이면 평가가 없으므로 그 전 평가일 값을 쓴다(5/31 일요일 → 5/29).
 * 무엇이 평가일인지는 출처가 준 날짜로만 안다 — 휴일 달력을 따로 두지 않는다.
 * 마지막 평가일의 값이 비어 있으면 산출불가다. 그 전 평가일로 더 내려가지 않는다.
 *
 * 3사 평균은 출처가 낸 값 그대로 쓴다. 출처는 셋째 자리 아래를 버리므로 직접 평균을
 * 내면 화면과 0.001 어긋날 수 있다(정책 §4).
 */

import { gradeBy, type Grade } from '@/domain/risk/grade';
import {
  FUNDING_RISK_BANDS,
  OBSERVATION_LAG_MONTHS,
  spread,
  type Spread,
} from '@/domain/risk/funding-risk/policy';
import { lastDayOf, monthOfDate, type CalendarDate } from '@/domain/shared/calendar-date';
import { addMonths, type YearMonth } from '@/domain/shared/year-month';

/** 3사 평균에 들어가는 채권평가사. 화면의 열 순서다. */
export const AGENCIES = ['나이스피앤아이', '한국자산평가', 'KIS자산평가'] as const;
export type Agency = (typeof AGENCIES)[number];

/** 한 채권의 하루치 금리(%). 값이 없는 칸은 null이다 — 0으로 채우지 않는다. */
export type BondYield = {
  readonly average: number | null;
  readonly byAgency: Readonly<Record<Agency, number | null>>;
};

/** 3사 평균이 있는 금리. 판정에 쓴 값이다. */
export type QuotedYield = BondYield & { readonly average: number };

/** 평가일 하루치. */
export type DailyYields = {
  readonly date: CalendarDate;
  /** 특수채/공사채 및 공단채/AAA, 1년 */
  readonly publicAaa: BondYield;
  /** 국채/국고채권/양곡,외평,재정, 1년 */
  readonly treasury: BondYield;
};

export type FundingRisk =
  | {
      readonly kind: 'ok';
      readonly judgedMonth: YearMonth;
      readonly observedMonth: YearMonth;
      /** 실제로 쓴 평가일. 말일이 평가일이 아니면 그 전 평가일이다. */
      readonly evaluationDate: CalendarDate;
      /** 관측월의 달력 말일. evaluationDate와 다르면 화면이 그 사실을 밝힌다. */
      readonly monthEnd: CalendarDate;
      readonly publicAaa: QuotedYield;
      readonly treasury: QuotedYield;
      readonly spread: Spread;
      readonly grade: Grade;
    }
  | {
      readonly kind: 'unavailable';
      readonly judgedMonth: YearMonth;
      readonly observedMonth: YearMonth;
      readonly reason: string;
    };

/** 판단월 J의 관측월 = J − 1. */
export function observedMonthOf(judged: YearMonth): YearMonth {
  return addMonths(judged, -OBSERVATION_LAG_MONTHS);
}

/**
 * 금리 차이. 1/1000 %p 정수로 바꿔 뺀다.
 *
 * 금리는 소수 셋째 자리까지 온다. 부동소수로 빼면 3.243 − 3.003 = 0.23999…가 되어
 * 0.24 경계를 넘지 못한다. 정수 차이를 1000으로 나누면 구간표의 0.24와 같은 부동소수가 된다.
 */
export function spreadOf(publicAaa: number, treasury: number): Spread {
  return spread((toThousandths(publicAaa) - toThousandths(treasury)) / 1000);
}

function toThousandths(rate: number): number {
  return Math.round(rate * 1000);
}

/** days에는 관측월 밖의 날이 섞여도 된다. 관측월의 날만 본다. */
export function assessFundingRisk(judged: YearMonth, days: readonly DailyYields[]): FundingRisk {
  const observed = observedMonthOf(judged);
  const unavailable = (reason: string): FundingRisk => ({
    kind: 'unavailable',
    judgedMonth: judged,
    observedMonth: observed,
    reason,
  });

  const inMonth = days.filter((d) => monthOfDate(d.date) === observed);
  if (inMonth.length === 0) return unavailable(`${observed}에 평가일이 없습니다.`);

  const last = inMonth.reduce((a, b) => (b.date > a.date ? b : a));
  const { publicAaa, treasury } = last;
  if (publicAaa.average === null || treasury.average === null) {
    const empty = [publicAaa.average === null ? '공사채 AAA' : null, treasury.average === null ? '국고채' : null]
      .filter((x) => x !== null)
      .join('·');
    return unavailable(`${last.date} 평가일의 ${empty} 3사 평균이 비어 있습니다.`);
  }

  const value = spreadOf(publicAaa.average, treasury.average);
  return {
    kind: 'ok',
    judgedMonth: judged,
    observedMonth: observed,
    evaluationDate: last.date,
    monthEnd: lastDayOf(observed),
    publicAaa: { ...publicAaa, average: publicAaa.average },
    treasury: { ...treasury, average: treasury.average },
    spread: value,
    grade: gradeBy(FUNDING_RISK_BANDS, value),
  };
}
