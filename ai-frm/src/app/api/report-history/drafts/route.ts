import { handleDraftsGet, handleDraftsPost } from '@/app/api/_lib/report-history-editor-handlers';
import { historyCorrectionProvider } from '@/app/api/_lib/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export function GET(request: Request): Promise<Response> { return handleDraftsGet(request, historyCorrectionProvider); }
export function POST(request: Request): Promise<Response> { return handleDraftsPost(request, historyCorrectionProvider); }
