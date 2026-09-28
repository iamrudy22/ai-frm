/** GET ?baseMonth=YYYY/MM&reportMonth=YYYY/MM — 건설경기 인식 지수(기준월 한 달)와 진단. */
import { handlePerception } from '@/app/api/_lib/handlers';
import { indicatorSource, ledgerRepository } from '@/app/api/_lib/composition';

// 요청마다 산출한다. ECOS 응답은 조립 지점의 10분 캐시가 재사용한다. 빌드 때 굳지 않게 명시한다.
export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return handlePerception(request, indicatorSource(), ledgerRepository());
}
