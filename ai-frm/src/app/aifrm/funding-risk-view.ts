/**
 * 조달위험 인식 지수 카드의 표시 — 산출된 값의 모양만 정한다. 계산하지 않는다.
 */

import type { FundingRiskReportDto, FundingRiskResponse } from '@/app/api/funding-risk/dto';
import { AGENCIES, type Agency, type BondYield, type FundingRisk } from '@/domain/risk/funding-risk/funding-risk';
import { percentPoints } from './format';

type Ok = Extract<FundingRisk, { kind: 'ok' }>;

const NONE = '—';

/** 금리(%)는 출처처럼 셋째 자리까지. 빈칸은 —. */
export function rateText(rate: number | null): string {
  return rate === null ? NONE : rate.toFixed(3);
}

export type YieldRow = { 채권: string; '3사 평균': string } & Record<Agency, string> & Record<string, unknown>;

/** 두 채권의 평가사별 금리와 3사 평균, 그리고 두 평균의 차이. */
export function yieldRows(result: Ok): YieldRow[] {
  const row = (name: string, bond: BondYield): YieldRow => ({
    채권: name,
    나이스피앤아이: rateText(bond.byAgency.나이스피앤아이),
    한국자산평가: rateText(bond.byAgency.한국자산평가),
    KIS자산평가: rateText(bond.byAgency.KIS자산평가),
    '3사 평균': rateText(bond.average),
  });
  const blank = Object.fromEntries(AGENCIES.map((a) => [a, ''])) as Record<Agency, string>;
  return [
    row('공사채 AAA 1년', result.publicAaa),
    row('국고채 1년', result.treasury),
    { 채권: '금리 차이', ...blank, '3사 평균': percentPoints(result.spread) },
  ];
}

/** 판단월과 어느 달 금리인지. 판단월이 회차에서 왔는지 오늘에서 왔는지 밝힌다. */
export function basisText(report: Pick<FundingRiskReportDto, 'source' | 'result'>): string {
  const { result, source } = report;
  const from = source === '회차' ? '최신 회차' : '회차 없음, 오늘 기준';
  return `판단월 ${result.judgedMonth}(${from}) · ${result.observedMonth} 말 금리`;
}

/** 말일이 평가일이 아니었으면 그 사실을 밝힌다. 말일 값을 썼으면 null. */
export function evaluationNote(result: Ok): string | null {
  if (result.evaluationDate === result.monthEnd) return null;
  return `${result.monthEnd}은 평가일이 아니어서 그 전 평가일 ${result.evaluationDate}의 금리를 씁니다.`;
}

/**
 * 다시 불러오면 나아질 수 있는가. 조회하지 못한 산출불가(fetchedAt 없음)와 서버 실패다.
 * 받은 값이 비어 있던 산출불가는 다시 불러도 같다.
 */
export function canRetry(response: FundingRiskResponse): boolean {
  if (!response.ok) return true;
  return response.value.result.kind === 'unavailable' && response.value.fetchedAt === null;
}
