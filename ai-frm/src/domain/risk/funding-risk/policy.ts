/**
 * 조달위험 인식 지수 판정 정책 — 금리 차이 구간표, 관측 시차, 등급별 코멘트.
 *
 * 정본: 자금기획팀 기준(2026-09-28). 옮긴 기록과 근거는
 * docs/plans/2026-09-28-jodal-wiheom-policy.md §2~§3.
 *
 * 이 지표의 정책은 이 파일만 소유한다. 다른 지표의 정책과 한 파일에 두지 않는다.
 *
 * 값은 비율이 아니라 금리 차이(%p)다. 0.24 = 0.24%p. 기준이 %p로 적혀 있어 그대로 옮긴다.
 */

import { defineBands, type Grade } from '@/domain/risk/grade';

declare const brand: unique symbol;

/**
 * 금리 차이(%p). 공사채 AAA − 국고채.
 *
 * 비율이 아니므로 비율 구간표에 넣을 수 없게 제 타입을 둔다(risk/grade의 GradeBands).
 */
export type Spread = number & { readonly [brand]: 'Spread' };

export function spread(n: number): Spread {
  if (!Number.isFinite(n)) {
    throw new Error(`금리 차이는 유한한 수여야 합니다: ${n}`);
  }
  return n as Spread;
}

/** 경계값은 위 단계다(0.24%p는 주의). 음수(공사채가 더 싸다)는 정상이다. */
export const FUNDING_RISK_BANDS = defineBands<Spread>([
  { atLeast: 0.79, grade: '위기' },
  { atLeast: 0.52, grade: '경고' },
  { atLeast: 0.24, grade: '주의' },
  { atLeast: Number.NEGATIVE_INFINITY, grade: '정상' },
]);

/** 관측 시차. 판단월 J는 J − 이 개월 수인 달의 마지막 평가일 금리로 판정한다(8월 판단 → 7/31). */
export const OBSERVATION_LAG_MONTHS = 1;

/**
 * 등급별 한 줄 코멘트.
 *
 * 원문이 없어 임시 문구다. 자금기획팀 원문을 받으면 이 표만 바꾼다.
 */
const COMMENTS: Record<Grade, string> = {
  정상: '공사채 조달 금리가 국고채와 크게 벌어지지 않았습니다.',
  주의: '공사채 조달 금리가 국고채보다 벌어지고 있습니다. 추이를 확인하세요.',
  경고: '공사채 조달 비용이 크게 올랐습니다. 조달 시점과 규모를 점검하세요.',
  위기: '공사채 조달 여건이 크게 나빠졌습니다. 즉시 대응이 필요합니다.',
};

export function commentFor(grade: Grade): string {
  return COMMENTS[grade];
}
