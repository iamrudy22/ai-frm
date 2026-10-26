import { handleCorrectionPost } from '@/app/api/_lib/report-history-exchange-handlers';
import { historyExportProvider } from '@/app/api/_lib/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export function POST(request: Request): Promise<Response> { return handleCorrectionPost(request, historyExportProvider); }
