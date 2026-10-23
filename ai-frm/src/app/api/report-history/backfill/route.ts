import { handleBackfillGet, handleBackfillPost } from '@/app/api/_lib/report-history-handlers';
import { historyProvider, indicatorSource, yieldSource } from '@/app/api/_lib/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const provider = () => historyProvider(indicatorSource(), yieldSource(), () => new Date());
export function POST(request: Request): Promise<Response> { return handleBackfillPost(request, provider); }
export function GET(request: Request): Promise<Response> { return handleBackfillGet(request, provider); }
