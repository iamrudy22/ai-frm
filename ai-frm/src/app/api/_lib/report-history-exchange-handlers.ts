import { downloadCorrectionWorkbook, exportCorrectionWorkbook } from '@/application/report-history/report-correction';
import type { ReportCorrectionDependencies } from '@/application/report-history/ports';
import { bodyOf, json, localOrigin } from './report-history-handlers';

type Provider = () => Promise<{ readonly scopeId: string; readonly deps: ReportCorrectionDependencies }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
function failure(error: unknown): Response {
  const code = error instanceof Error ? error.message : 'STORAGE_UNAVAILABLE';
  const status = code === 'NOT_FOUND' ? 404 : code === 'LIMIT_EXCEEDED' || code === 'BODY_TOO_LARGE' ? 413 :
    code === 'UNSUPPORTED_VERSION' ? 422 : /^INVALID_/.test(code) ? 400 : 503;
  return json({ ok: false, code: status === 503 ? 'STORAGE_UNAVAILABLE' : code }, status, status === 503 ? { 'Retry-After': '1' } : undefined);
}

export async function handleExchangePost(request: Request, provider: Provider): Promise<Response> {
  try {
    if (!localOrigin(request)) return json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403);
    const body = await bodyOf(request, 1_000_000);
    if (Object.keys(body).sort().join('|') !== 'action|confirmationId' || body.action !== 'export' || !validId(body.confirmationId)) throw Error('INVALID_EXPORT_REQUEST');
    const { scopeId, deps } = await provider();
    const saved = await exportCorrectionWorkbook(deps, scopeId, body.confirmationId);
    return json({ ok: true, exportId: saved.exportId, downloadUrl: `/api/report-history/exchange?exportId=${encodeURIComponent(saved.exportId)}` });
  } catch (error) { return failure(error); }
}

export async function handleExchangeGet(request: Request, provider: Provider): Promise<Response> {
  try {
    if (!localOrigin(request)) return json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403);
    const url = new URL(request.url);
    if (url.searchParams.size !== 1 || !validId(url.searchParams.get('exportId'))) throw Error('INVALID_EXPORT_ID');
    const { scopeId, deps } = await provider();
    const exportId = url.searchParams.get('exportId')!;
    const manifest = await deps.repository.getWorkbookExport(scopeId, exportId);
    if (!manifest) throw Error('NOT_FOUND');
    const bytes = await downloadCorrectionWorkbook(deps, scopeId, exportId);
    const filename = `aifrm-history-${manifest.basis.reportTitleMonth.replace('/', '')}-r${manifest.baseRevision}-${exportId.slice(0, 8)}.xlsx`;
    return new Response(Buffer.from(bytes), { status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return failure(error); }
}
