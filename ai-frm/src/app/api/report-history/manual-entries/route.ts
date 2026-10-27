import { handleManualEntryGet, handleManualEntryPost } from '@/app/api/_lib/report-history-manual-entry-handlers';
import { historyManualEntryProvider } from '@/app/api/_lib/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export function GET(request: Request): Promise<Response> { return handleManualEntryGet(request, historyManualEntryProvider); }
export function POST(request: Request): Promise<Response> { return handleManualEntryPost(request, historyManualEntryProvider); }
