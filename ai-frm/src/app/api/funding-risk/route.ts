/** POST { judgedMonth? } — 조달위험 인식 지수(판단월 한 달). */
import { handleFundingRisk } from '@/app/api/_lib/handlers';
import { yieldSource } from '@/app/api/_lib/composition';

// 요청마다 채권정보센터를 부른다. 빌드 때 굳지 않게 명시한다.
export const dynamic = 'force-dynamic';

export function POST(request: Request): Promise<Response> {
  return handleFundingRisk(request, yieldSource());
}
