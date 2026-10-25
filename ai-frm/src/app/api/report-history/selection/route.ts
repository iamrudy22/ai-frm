import { handleHistorySelectionGet, handleHistorySelectionPost } from '@/app/api/_lib/report-history-selection-handlers';
import { historyReadProvider } from '@/app/api/_lib/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export function POST(request: Request): Promise<Response> { return handleHistorySelectionPost(request, historyReadProvider); }
export function GET(request: Request): Promise<Response> { return handleHistorySelectionGet(request, historyReadProvider); }
