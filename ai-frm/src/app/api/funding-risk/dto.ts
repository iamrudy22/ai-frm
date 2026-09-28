/**
 * 라우트가 돌려주는 JSON의 모양. 화면은 이 타입만 안다.
 *
 * 도메인 결과를 그대로 JSON으로 내보낸다. 달라지는 것은 조회 시각(Date → ISO 문자열)뿐이다.
 * 달력 월·날짜·금리 차이 같은 브랜드 값은 JSON에서도 문자열·수 그대로라 타입을 그대로 쓴다.
 */

import type { FundingRiskReport } from '@/application/funding-risk';
import type { Outcome } from '@/application/outcome';

export type FundingRiskReportDto = Omit<FundingRiskReport, 'fetchedAt'> & { readonly fetchedAt: string | null };

export type FundingRiskResponse = Outcome<FundingRiskReportDto>;
