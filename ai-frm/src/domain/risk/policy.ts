/**
 * 판정 정책 — 지표별 구간표와 등급별 코멘트.
 *
 * 정본: docs/meeting-notes/2026-09-09-daegeum-hoe-su-risk.md
 *
 * 원래 각 지표의 점수 기준표는 자금기획팀의 엑셀 시트 안에 있다.
 * 그 기준표를 받으면 출처를 그쪽으로 옮긴다(이벤트 스토밍 6장 1번).
 * 기준이 코드 곳곳에 흩어지지 않도록 이 파일이 혼자 소유한다.
 *
 * 값은 비율이다. 회의록이 "0.5 이상"처럼 비율로 적고 있고,
 * 퍼센트 변환은 화면에서만 한다.
 */

import { defineBands, type Grade } from '@/domain/risk/grade';

const NO_FLOOR = Number.NEGATIVE_INFINITY;

/** 유동성 Gap — 기초시재 ÷ 3개월 순지출 */
export const LIQUIDITY_GAP_BANDS = defineBands([
  { atLeast: 0.5, grade: '정상' },
  { atLeast: 0.25, grade: '주의' },
  { atLeast: 0.15, grade: '경고' },
  { atLeast: NO_FLOOR, grade: '위기' },
]);

/** 대금 회수 위험 — 실적 ÷ 계획 */
export const PAYMENT_RECOVERY_BANDS = defineBands([
  { atLeast: 0.9, grade: '정상' },
  { atLeast: 0.8, grade: '주의' },
  { atLeast: 0.7, grade: '경고' },
  { atLeast: NO_FLOOR, grade: '위기' },
]);

/**
 * 3개월간 자금이 순유입이면 유동성 압박이 없다고 본다.
 *
 * 산식 쪽에 '정상'을 박아 두면 정책이 코드로 새므로 여기서 소유한다.
 * 자금기획팀이 "순유입이라도 시재가 없으면 주의" 같은 기준을 주면 이 값만 바꾼다.
 */
export const GRADE_WHEN_NET_INFLOW: Grade = '정상';

export type IndicatorKey = 'liquidity-gap' | 'payment-recovery';

/**
 * 등급별 한 줄 코멘트.
 *
 * 현재는 임시 문구다. 자금기획팀이 등급별 원문을 제공하기로 되어 있고,
 * 받으면 이 표만 교체한다.
 */
const COMMENTS: Record<IndicatorKey, Record<Grade, string>> = {
  'liquidity-gap': {
    정상: '현재 시재로 3개월 순지출을 충분히 커버할 수 있습니다.',
    주의: '시재 여유가 줄고 있습니다. 추이를 확인하세요.',
    경고: '시재 압박이 나타납니다. 자금 계획을 점검하세요.',
    위기: '시재가 3개월 순지출에 크게 못 미칩니다. 즉시 대응이 필요합니다.',
  },
  'payment-recovery': {
    정상: '계획 대비 실적이 양호합니다.',
    주의: '계획 대비 실적이 다소 낮습니다. 추이를 확인하세요.',
    경고: '계획 대비 실적 미달이 분명합니다. 원인을 점검하세요.',
    위기: '계획 대비 실적 미달이 큽니다. 즉시 대응이 필요합니다.',
  },
};

export function commentFor(indicator: IndicatorKey, grade: Grade): string {
  return COMMENTS[indicator][grade];
}
