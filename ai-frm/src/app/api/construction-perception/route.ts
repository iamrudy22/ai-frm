/** GET ?baseMonth=YYYY/MM&reportMonth=YYYY/MM — 건설경기 인식 지수(기준월 한 달)와 진단. */
import { handlePerception } from '@/app/api/_lib/handlers';
import { indicatorSource, ledgerRepository } from '@/app/api/_lib/composition';

// 월 1회 갱신 자료지만 처음에는 캐시하지 않는다(구현 계획 §10). 빌드 때 굳지 않게 명시한다.
export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return handlePerception(request, indicatorSource(), ledgerRepository());
}
