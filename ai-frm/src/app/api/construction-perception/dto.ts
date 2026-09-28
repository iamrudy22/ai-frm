/**
 * 라우트가 돌려주는 JSON의 모양. 화면은 이 타입만 안다.
 *
 * 도메인 결과를 그대로 JSON으로 내보낸다. 달라지는 것은 날짜(Date → ISO 문자열)뿐이다.
 * 달력 월·지수 같은 브랜드 값은 JSON에서도 문자열·수 그대로라 타입을 그대로 쓴다.
 */

import type { PerceptionDiagnostics, PerceptionReport } from '@/application/construction-perception';
import type { Outcome } from '@/application/outcome';
import type { RecordedRound } from '@/application/record-round';

export type PerceptionReportDto = Omit<PerceptionReport, 'diagnostics'> & {
  readonly diagnostics: Omit<PerceptionDiagnostics, 'fetchedAt'> & { readonly fetchedAt: string };
};

export type PerceptionResponse = Outcome<PerceptionReportDto>;
export type RecordRoundResponse = Outcome<RecordedRound>;
