/** POST — 최신 회차에서 뗀 기재분(실적 1개, 계획 3개)을 분양회수 계획·실적 이력에 반영한다. */
import { handleRecordRound } from '@/app/api/_lib/handlers';
import { ledgerRepository } from '@/app/api/_lib/composition';

export function POST(request: Request): Promise<Response> {
  return handleRecordRound(request, ledgerRepository());
}
