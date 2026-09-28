/**
 * 결과 요약 — 다섯 지표를 한 줄로 먼저 보인다. 상세는 그 아래 섹션에 그대로 있다.
 *
 * 등급이 있는 지표(대금 회수 위험·유동성 Gap·건설경기·조달위험 인식 지수)는 등급 배지로,
 * 등급이 없는 적정 시재는 점과 T/F로 보인다 — 같은 모양이면 등급이 있는 지표로
 * 읽히기 때문이다(page.tsx 적정 시재 주석과 같은 이유).
 *
 * 계산은 하지 않는다. 산출된 값의 모양만 정한다.
 */

import type { PerceptionResponse } from '@/app/api/construction-perception/dto';
import type { FundingRiskResponse } from '@/app/api/funding-risk/dto';
import type { Dashboard } from '@/application/dashboard';
import { verdictLabel } from '@/domain/risk/adequate-cash/policy';
import type { Grade } from '@/domain/risk/grade';
import { toPercent } from '@/domain/shared/amount';
import type { YearMonth } from '@/domain/shared/year-month';
import { money, percent, percentPoints } from './format';

export type SummaryStatus =
  | { readonly kind: 'grade'; readonly grade: Grade }
  | { readonly kind: 'dot'; readonly variant: 'success' | 'warning' | 'error' | 'neutral'; readonly label: string };

export type SummaryTile = {
  readonly title: string;
  readonly status: SummaryStatus;
  readonly value: string;
  readonly note: string;
};

const MINUS = '−';
const NONE = '—';
const SEE_BELOW = '아래 사유를 확인하세요';

const dot = (variant: Extract<SummaryStatus, { kind: 'dot' }>['variant'], label: string): SummaryStatus => ({
  kind: 'dot',
  variant,
  label,
});

/**
 * 대금 회수 위험의 달 표기. 판단월은 최신 회차의 달이고, 회수율은 그 회차에 적힌
 * 가장 최근 실적(직전 달)을 이전 회차의 같은 달 계획과 견준 값이다.
 * 7월 판단 = 6월 회차의 6월 계획 vs 7월 회차의 6월 실적. 7월 실적은 8월 회차에야 있다.
 * 건설경기 인식 지수의 7월 판단이 4~6월 실적을 쓰는 것과 같은 방식이다.
 */
export function recoveryBasis(judged: YearMonth, target: YearMonth | null): string {
  return target === null ? `${judged} 판단` : `${judged} 판단 · ${target} 실적 기준`;
}

export function recoveryTile(
  recovery: Dashboard['paymentRecovery'],
  context: { readonly judged: YearMonth; readonly target: YearMonth | null; readonly previousRound: YearMonth },
): SummaryTile {
  const title = '대금 회수 위험';
  if (recovery === null) {
    return { title, status: dot('neutral', '판정 안 함'), value: NONE, note: `${context.previousRound} 회차가 없습니다` };
  }
  if (!recovery.ok) return { title, status: dot('error', '판정 불가'), value: NONE, note: SEE_BELOW };
  return {
    title,
    status: { kind: 'grade', grade: recovery.value.grade },
    value: percent(toPercent(recovery.value.rate)),
    note: `회수율 · ${recoveryBasis(context.judged, context.target)}`,
  };
}

export function gapTile(gap: Dashboard['liquidityGap'], span: string): SummaryTile {
  const title = '유동성 Gap';
  if (!gap.ok) return { title, status: dot('error', '산출 불가'), value: NONE, note: SEE_BELOW };
  return {
    title,
    status: { kind: 'grade', grade: gap.value.grade },
    value: gap.value.kind === 'gap' ? percent(toPercent(gap.value.gapRatio)) : '순유입',
    note: span,
  };
}

export function adequateCashTile(adequateCash: Dashboard['adequateCash'], span: string): SummaryTile {
  const title = '적정 시재';
  if (!adequateCash.ok) return { title, status: dot('error', '산출 불가'), value: NONE, note: SEE_BELOW };
  const { isAdequate, surplus } = adequateCash.value;
  return {
    title,
    // 큰 값은 엑셀과 같은 T/F. 금액은 칸 폭에 비해 길어 보조 문장에 둔다.
    status: dot(isAdequate ? 'success' : 'warning', verdictLabel(isAdequate)),
    value: isAdequate ? 'T' : 'F',
    note: `현재 − 적정 ${surplus < 0 ? MINUS : '+'}${money(Math.abs(surplus))} · ${span}`,
  };
}

/** perception이 null이면 아직 불러오는 중이다. */
export function perceptionTile(perception: PerceptionResponse | null): SummaryTile {
  const title = '건설경기 인식 지수';
  if (perception === null) return { title, status: dot('neutral', '불러오는 중'), value: '…', note: 'ECOS 조회 중' };
  if (!perception.ok) return { title, status: dot('error', '산출 불가'), value: NONE, note: SEE_BELOW };
  const result = perception.value.result;
  if (result.kind === 'unavailable') {
    return {
      title,
      status: dot('warning', '산출불가'),
      value: NONE,
      note: `기준월 ${result.month} · ${result.missing.length}개 지표 값 없음`,
    };
  }
  return {
    title,
    status: { kind: 'grade', grade: result.grade },
    value: result.index.toFixed(2),
    note: `종합위기인식지수 · 기준월 ${result.month}`,
  };
}

/** response가 null이면 아직 불러오는 중이다. */
export function fundingRiskTile(response: FundingRiskResponse | null): SummaryTile {
  const title = '조달위험 인식 지수';
  if (response === null) return { title, status: dot('neutral', '불러오는 중'), value: '…', note: '채권정보센터 조회 중' };
  if (!response.ok) return { title, status: dot('error', '산출 불가'), value: NONE, note: SEE_BELOW };
  const result = response.value.result;
  if (result.kind === 'unavailable') {
    return { title, status: dot('warning', '산출불가'), value: NONE, note: `${result.judgedMonth} 판단 · ${SEE_BELOW}` };
  }
  return {
    title,
    status: { kind: 'grade', grade: result.grade },
    value: percentPoints(result.spread),
    note: `공사채 AAA − 국고채 · ${result.judgedMonth} 판단 · ${result.evaluationDate} 금리`,
  };
}
