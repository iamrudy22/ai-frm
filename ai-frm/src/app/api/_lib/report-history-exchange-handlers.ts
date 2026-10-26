import { confirmCorrection } from '@/application/report-history/report-correction';
import { correctionFailure, type CorrectionProvider } from './report-history-editor-handlers';
import { bodyOf, json, localOrigin } from './report-history-handlers';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);

export async function handleCorrectionPost(request: Request, provider: CorrectionProvider): Promise<Response> {
  try {
    if (!localOrigin(request)) return json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403);
    if (new URL(request.url).searchParams.size) throw Error('INVALID_CORRECTION_COMMAND');
    const body = await bodyOf(request, 6 * 1024 * 1024);
    if ([body.previewId, body.previewHash, body.idempotencyKey, body.reason].some(value => typeof value === 'string' && value.length > 2000)) throw Error('LIMIT_EXCEEDED');
    if (Object.keys(body).sort().join('|') !== ['previewId','previewHash','expectedBaseRevision','idempotencyKey','reason'].sort().join('|') ||
      !validId(body.previewId) || !validId(body.idempotencyKey) || typeof body.previewHash !== 'string' || !/^[a-f0-9]{64}$/i.test(body.previewHash) ||
      !Number.isSafeInteger(body.expectedBaseRevision) || (body.expectedBaseRevision as number) < 1 ||
      typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2000)
      return json({ ok: false, code: 'INVALID_CORRECTION_COMMAND' }, 422);
    const { scopeId, deps } = await provider();
    const result = await confirmCorrection(deps, scopeId, {
      previewId: body.previewId, previewHash: body.previewHash, expectedBaseRevision: body.expectedBaseRevision as number,
      idempotencyKey: body.idempotencyKey, reason: body.reason,
    });
    if ((result.kind === 'conflict' || result.kind === 'not-ready') && ![
      'STALE_BASE', 'STALE_DEPENDENCY', 'STALE_DRAFT', 'WORK_CLOSED', 'IDEMPOTENCY_KEY_REUSED',
      'INVALID_CORRECTION_COMMAND', 'INVALID_CORRECTION_LINEAGE', 'INVALID_BASIS', 'INVALID_REVISION', 'CORRECTION_REASON_REQUIRED',
    ].includes(result.reason)) return correctionFailure(Error('STORAGE_UNAVAILABLE'));
    return json({ ok: result.kind === 'confirmed' || result.kind === 'already-confirmed', result },
      result.kind === 'conflict' ? 409 : result.kind === 'not-ready' ? 422 : 200);
  } catch (error) { return correctionFailure(error); }
}

/** Retired before parsing, provider construction, repository access or file codecs. */
function retired(request: Request): Response {
  return !localOrigin(request) ? json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403) : json({ ok: false, code: 'EXCHANGE_RETIRED' }, 410);
}
export async function handleExchangePost(request: Request, provider?: CorrectionProvider): Promise<Response> { void provider; return retired(request); }
export async function handleExchangeGet(request: Request, provider?: CorrectionProvider): Promise<Response> { void provider; return retired(request); }
