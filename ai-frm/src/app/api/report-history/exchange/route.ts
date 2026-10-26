import { handleExchangeGet, handleExchangePost } from '@/app/api/_lib/report-history-exchange-handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export function POST(request: Request): Promise<Response> { return handleExchangePost(request); }
export function GET(request: Request): Promise<Response> { return handleExchangeGet(request); }
