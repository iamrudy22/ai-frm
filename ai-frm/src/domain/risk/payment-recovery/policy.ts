/**
 * 대금 회수 위험 판정 정책 — 구간표와 등급별 코멘트.
 *
 * 정본: docs/meeting-notes/2026-09-09-daegeum-hoe-su-risk.md
 *
 * 원래 점수 기준표는 자금기획팀의 엑셀 시트 안에 있다.
 * 그 기준표를 받으면 출처를 그쪽으로 옮긴다(이벤트 스토밍 6장 1번).
 *
 * 이 지표의 정책은 이 파일만 소유한다. 다른 지표의 정책과 한 파일에 두지 않는다 —
 * 한 지표의 기준을 바꿀 때 다른 지표의 코드와 테스트가 함께 흔들리면 안 된다
 * (docs/plans/2026-09-28-jipyo-bunri-plan.md). 경계는 src/boundaries.test.ts가 지킨다.
 *
 * 값은 비율이다. 회의록이 "0.9 이상"처럼 비율로 적고 있다.
 */

import { defineBands, type Grade } from '@/domain/risk/grade';

/** 실적 ÷ 계획 */
export const PAYMENT_RECOVERY_BANDS = defineBands([
  { atLeast: 0.9, grade: '정상' },
  { atLeast: 0.8, grade: '주의' },
  { atLeast: 0.7, grade: '경고' },
  { atLeast: Number.NEGATIVE_INFINITY, grade: '위기' },
]);

/**
 * 등급별 한 줄 코멘트.
 *
 * 현재는 임시 문구다. 자금기획팀이 등급별 원문을 제공하기로 되어 있고,
 * 받으면 이 표만 교체한다.
 */
const COMMENTS: Record<Grade, string> = {
  정상: '계획 대비 실적이 양호합니다.',
  주의: '계획 대비 실적이 다소 낮습니다. 추이를 확인하세요.',
  경고: '계획 대비 실적 미달이 분명합니다. 원인을 점검하세요.',
  위기: '계획 대비 실적 미달이 큽니다. 즉시 대응이 필요합니다.',
};

export function commentFor(grade: Grade): string {
  return COMMENTS[grade];
}
