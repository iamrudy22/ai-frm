import { handleConfirmationGet, handleConfirmationPost } from '@/app/api/_lib/report-history-confirmation-handlers';
import { historyProvider, indicatorSource, yieldSource } from '@/app/api/_lib/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
const provider = () => historyProvider(indicatorSource(), yieldSource(), () => new Date());
export function POST(request: Request): Promise<Response> { return handleConfirmationPost(request, provider); }
export function GET(request: Request): Promise<Response> { return handleConfirmationGet(request, provider); }
