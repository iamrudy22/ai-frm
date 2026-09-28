/**
 * 건설경기 인식 지수 판정 정책 — 점수화 기준 표, 가중치, 단계 구간표.
 *
 * 정본: 엑셀 `3. 건설경기인식지수(2026).xlsx`의 `재무위기인식지수_위기단계` 시트.
 * 옮긴 기록과 근거는 docs/plans/2026-09-28-geonseol-gyeonggi-policy.md §2~§3.
 *
 * 점수화 기준은 함수가 아니라 표다(DDD 검토 §10-5). 엑셀 B~K열의 IF문 하나가
 * 표의 한 줄이다. 엑셀 기준표를 정본으로 받으면 이 표만 바꾼다. 표를 해석하는
 * 함수(scoreBy)는 산식 쪽에 하나만 있다.
 *
 * 이 지표의 정책은 이 파일만 소유한다. 다른 지표의 정책과 한 파일에 두지 않는다.
 */

import { defineBands, type Grade } from '@/domain/risk/grade';

export type IndicatorKey =
  | '총수주액'
  | '주택매매가격지수'
  | '미분양주택현황'
  | '주택건설인허가실적'
  | '설비투자지수'
  | '대출금리'
  | '분양회수예측오차'
  | '환율'
  | '주가'
  | '선행지수순환변동치';

/**
 * 원값을 변화율로 바꾸는 방식(엑셀 기초데이터 시트 4행).
 *
 * 대출금리만 비율이 아니라 **%p 차이 × 100 = bp**다. 금리 4.19 → 4.31이면 12다.
 * 그래서 대출금리의 만점·영점도 bp(60, 20)로 적는다.
 */
export type Transform = '전년동월비' | '전월대비' | '전월차bp' | '3개월누적오차율';

/** 무엇이 위험한가. 양방향(환율)은 변화율의 절댓값을 본다. */
export type Direction = '하락' | '상승' | '양방향';

/**
 * 점수화 기준 한 줄.
 *
 * 변화율이 `full` 쪽 끝에 닿으면 1점, `zero` 쪽이면 0점, 그 사이는 선형이다.
 *   하락: r ≤ full → 1, r ≥ zero → 0
 *   상승·양방향: r ≥ full → 1, r ≤ zero → 0
 *
 * 엑셀은 인허가(4번)·선행지수(10번)만 0점 조건을 `>`(초과)로 쓴다. 그러나 선형식이
 * 영점에서 정확히 0이 되므로 결과는 `>=`와 같다. 그래서 따로 적지 않는다.
 */
export type ScoringRule = {
  readonly key: IndicatorKey;
  readonly transform: Transform;
  readonly direction: Direction;
  readonly full: number;
  readonly zero: number;
  /** 엑셀 `위기단계!B2:K2`. 자릿수를 줄이면 엑셀과 소수점 6자리가 맞지 않는다. */
  readonly weight: number;
};

/** 엑셀 열 순서(B~K). 지수 합산도 이 순서로 한다. */
export const SCORING_RULES: readonly ScoringRule[] = [
  { key: '총수주액', transform: '전년동월비', direction: '하락', full: -0.6, zero: 0, weight: 11.063470732420035 },
  { key: '주택매매가격지수', transform: '전월대비', direction: '하락', full: -0.015, zero: 0, weight: 23 },
  { key: '미분양주택현황', transform: '전월대비', direction: '상승', full: 0.3, zero: 0.1, weight: 3.984974701683903 },
  { key: '주택건설인허가실적', transform: '전년동월비', direction: '하락', full: -0.6, zero: 0, weight: 31 },
  { key: '설비투자지수', transform: '전월대비', direction: '하락', full: -0.1, zero: -0.05, weight: 13.755780912942885 },
  { key: '대출금리', transform: '전월차bp', direction: '상승', full: 60, zero: 20, weight: 1.8935899081681278 },
  { key: '분양회수예측오차', transform: '3개월누적오차율', direction: '하락', full: -0.4, zero: 0, weight: 3.2099498080195237 },
  { key: '환율', transform: '전월대비', direction: '양방향', full: 0.07, zero: 0.03, weight: 4.783203423392172 },
  { key: '주가', transform: '전월대비', direction: '하락', full: -0.15, zero: -0.05, weight: 4.783203423392172 },
  { key: '선행지수순환변동치', transform: '전월대비', direction: '하락', full: -0.006, zero: -0.002, weight: 3 },
];

/**
 * 보고 시차. 기준월 = 보고월 − 이 개월 수(정책 §5, 2026-09-28 개정).
 *
 * 건설·주택 통계는 익월 말에 수록된다. 그래서 보고하는 달에는 두 달 전까지가
 * 온전히 나와 있다. 9월에 보면 7월, 8월 회차를 올리면 6월이 기준월이다.
 */
export const REPORT_LAG_MONTHS = 2;

declare const brand: unique symbol;

/**
 * 종합위기인식지수. 가중치 × 점수의 합이라 0~100.474다.
 *
 * 비율이 아니므로 비율 구간표에 넣을 수 없게 제 타입을 둔다(risk/grade의 GradeBands).
 */
export type PerceptionIndex = number & { readonly [brand]: 'PerceptionIndex' };

export function perceptionIndex(n: number): PerceptionIndex {
  if (!Number.isFinite(n)) {
    throw new Error(`종합위기인식지수는 유한한 수여야 합니다: ${n}`);
  }
  return n as PerceptionIndex;
}

/**
 * 종합위기단계. 경계값은 위 단계다(엑셀 `L<20` 정상 → 20은 주의).
 *
 * 엑셀은 `L ≤ 100`일 때만 위기를 주고 넘으면 빈칸을 낸다. 가중치 합이 100.474라
 * 전 지표 만점이면 판정이 비는 결함이라, 여기서는 상한을 두지 않는다(정책 §3-6).
 */
export const STAGE_BANDS = defineBands<PerceptionIndex>([
  { atLeast: 60, grade: '위기' },
  { atLeast: 40, grade: '경고' },
  { atLeast: 20, grade: '주의' },
  { atLeast: Number.NEGATIVE_INFINITY, grade: '정상' },
]);

/**
 * 단계별 한 줄 코멘트.
 *
 * 엑셀에 원문이 없어 임시 문구다. 자금기획팀 원문을 받으면 이 표만 바꾼다.
 */
const COMMENTS: Record<Grade, string> = {
  정상: '건설경기 지표가 안정적입니다.',
  주의: '일부 건설경기 지표가 악화되었습니다. 추이를 확인하세요.',
  경고: '건설경기 악화가 여러 지표에서 뚜렷합니다. 자금 계획을 점검하세요.',
  위기: '건설경기 지표가 전반적으로 크게 악화되었습니다. 즉시 대응이 필요합니다.',
};

export function commentFor(grade: Grade): string {
  return COMMENTS[grade];
}
