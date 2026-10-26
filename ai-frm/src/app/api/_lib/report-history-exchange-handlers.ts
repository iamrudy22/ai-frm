import { downloadCorrectionWorkbook, exportCorrectionWorkbook, validateCorrectionWorkbook, getCorrectionPreview, confirmWorkbookCorrection } from '@/application/report-history/report-correction';
import type { ReportCorrectionDependencies } from '@/application/report-history/ports';
import { bodyOf, json, localOrigin } from './report-history-handlers';

type Provider = () => Promise<{ readonly scopeId: string; readonly deps: ReportCorrectionDependencies }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
function failure(error: unknown): Response {
  const code = error instanceof Error ? error.message : 'STORAGE_UNAVAILABLE';
  const status = code === 'NOT_FOUND' ? 404 : code === 'LIMIT_EXCEEDED' || code === 'BODY_TOO_LARGE' ? 413 :
    code === 'STALE_BASE' || code === 'STALE_DEPENDENCY' ? 409 : code === 'UNSUPPORTED_VERSION' || code === 'EVALUATION_ZONE_MISMATCH' || code === 'INVALID_WORKBOOK' ? 422 : /^INVALID_/.test(code) ? 400 : 503;
  return json({ ok: false, code: status === 503 ? 'STORAGE_UNAVAILABLE' : code }, status, status === 503 ? { 'Retry-After': '1' } : undefined);
}

export async function handleCorrectionPost(request: Request, provider: Provider): Promise<Response> {
  try {
    if (!localOrigin(request)) return json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403);
    const body = await bodyOf(request, 16_384);
    if (Object.keys(body).sort().join('|') !== ['previewId','previewHash','expectedBaseRevision','idempotencyKey','reason'].sort().join('|') ||
      !validId(body.previewId) || !validId(body.idempotencyKey) || typeof body.previewHash !== 'string' || !/^[a-f0-9]{64}$/i.test(body.previewHash) ||
      !Number.isSafeInteger(body.expectedBaseRevision) || (body.expectedBaseRevision as number) < 1 ||
      typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2000)
      return json({ ok: false, code: 'INVALID_CORRECTION_COMMAND' }, 422);
    const { scopeId, deps } = await provider();
    const result = await confirmWorkbookCorrection(deps, scopeId, {
      previewId: body.previewId, previewHash: body.previewHash, expectedBaseRevision: body.expectedBaseRevision as number,
      idempotencyKey: body.idempotencyKey, reason: body.reason,
    });
    return json({ ok: result.kind === 'confirmed' || result.kind === 'already-confirmed', result },
      result.kind === 'conflict' ? 409 : result.kind === 'not-ready' ? 422 : 200);
  } catch (error) { return failure(error); }
}

export async function handleExchangePost(request: Request, provider: Provider): Promise<Response> {
  try {
    if (!localOrigin(request)) return json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403);
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const limit = 6 * 1024 * 1024;
      if (Number(request.headers.get('content-length') ?? 0) > limit) throw Error('LIMIT_EXCEEDED');
      const reader = request.body?.getReader();
      if (!reader) throw Error('INVALID_WORKBOOK');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw Error('LIMIT_EXCEEDED');
        }
        chunks.push(value);
      }
      const buffer = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
      let form: FormData;
      try { form = await new Request(request.url, { method: 'POST', headers: { 'content-type': request.headers.get('content-type')! }, body: buffer }).formData(); } catch { throw Error('INVALID_WORKBOOK'); }
      if ([...form.keys()].sort().join('|') !== 'command|file' || form.get('command') !== 'validate') throw Error('INVALID_WORKBOOK');
      const file = form.get('file');
      if (!(file instanceof File)) throw Error('INVALID_WORKBOOK');
      if (file.size > 5 * 1024 * 1024) throw Error('LIMIT_EXCEEDED');
      const { scopeId, deps } = await provider();
      const result = await validateCorrectionWorkbook(deps, scopeId, new Uint8Array(await file.arrayBuffer()));
      return json({ ok: result.kind !== 'invalid', result }, result.kind === 'invalid' ? 422 : 200);
    }
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
    if (url.searchParams.size === 1 && validId(url.searchParams.get('previewId'))) {
      const { scopeId, deps } = await provider();
      const preview = await getCorrectionPreview(deps.repository, scopeId, url.searchParams.get('previewId')!);
      if (!preview) throw Error('NOT_FOUND');
      return json({ ok: true, preview });
    }
    if (url.searchParams.size !== 1 || !validId(url.searchParams.get('exportId'))) throw Error('INVALID_EXPORT_ID');
    const { scopeId, deps } = await provider();
    const exportId = url.searchParams.get('exportId')!;
    const manifest = await deps.repository.getWorkbookExport(scopeId, exportId);
    if (!manifest) throw Error('NOT_FOUND');
    const bytes = await downloadCorrectionWorkbook(deps, scopeId, exportId);
    const filename = `aifrm-history-${manifest.basis.reportTitleMonth.replace('/', '')}-r${manifest.baseRevision}-${exportId.slice(0, 8)}.xlsx`;
    return new Response(Buffer.from(bytes), {
      status: 200, headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) { return failure(error); }
}
