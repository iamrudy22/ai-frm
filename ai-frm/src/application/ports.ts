/**
 * 유스케이스가 바깥에 기대는 것 — 경제지표 출처(DDD 검토 §10-3)와 채권 금리 출처.
 *
 * 구현은 infrastructure/가 한다(ECOS Open API, 금융투자협회 채권정보센터). 분양회수 이력은 저장하지 않으므로
 * 저장소 포트가 없다(2026-09-28) — 요청마다 올린 회차로 만든다. 유스케이스는 이
 * 인터페이스만 알아서 규칙 4(유스케이스는 판독 계층을 모른다)를 지킨다.
 * 조립은 app/api/의 라우트가 한다.
 *
 * 포트의 타입은 전부 도메인 언어다. ECOS 응답 형식(통계표 코드, TIME='202607',
 * 문자열 DATA_VALUE)은 여기에 나오지 않는다 — 번역은 ACL이 끝낸다.
 */

import type { EcosIndicatorKey, RawSeries } from '@/domain/risk/construction-perception/construction-perception';
import type { DailyYields } from '@/domain/risk/funding-risk/funding-risk';
import type { YearMonth } from '@/domain/shared/year-month';

/**
 * 지표 하나의 조회 결과. 성공이면 달력 월별 원값과 단위, 실패면 사유다.
 *
 * 최신월은 따로 받지 않는다. 계열의 마지막 달이 곧 최신월이라, 두 칸으로 두면
 * 서로 어긋날 수 있다.
 */
export type IndicatorFetch =
  | {
      readonly values: RawSeries;
      readonly unit: string;
      /** 응답을 받은 시각. 캐시에서 꺼낸 값이면 처음 받은 시각이다. */
      readonly fetchedAt?: Date;
    }
  | { readonly error: string };

export type SourceResult = Readonly<Record<EcosIndicatorKey, IndicatorFetch>>;

/** 경제지표 9종의 출처. 한 지표의 실패가 다른 지표를 막지 않는다. */
export interface EconomicIndicatorSource {
  fetchAll(): Promise<SourceResult>;
}

/**
 * 한 달치 채권 시가평가 금리의 조회 결과. 성공이면 그 달의 평가일별 금리, 실패면 사유다.
 * 평가일이 하루도 없으면 빈 목록이다 — 실패가 아니다.
 */
export type YieldFetch =
  | { readonly days: readonly DailyYields[]; readonly fetchedAt: Date }
  | { readonly error: string };

/** 채권 시가평가 금리(공사채 AAA·국고채 1년, 3사)의 출처. */
export interface BondYieldSource {
  /** 그 달 1일~말일의 평가일별 금리. 평가일이 아닌 날은 오지 않는다. */
  dailyYields(month: YearMonth): Promise<YieldFetch>;
}
