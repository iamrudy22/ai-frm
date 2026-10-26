import { planBackfill, runBackfillStep, startBackfill, BackfillRetryError, type BackfillInput } from '@/application/report-history/historical-risk-backfill';
import type { HistoryDependencies } from '@/application/report-history/ports';
import { parseYearMonth } from '@/domain/shared/year-month';
import { ledgerOf } from '@/domain/cashflow/forecast-ledger';
import { redactSourceCredentials } from '@/infrastructure/report-history/captured-sources';

type Provider = () => Promise<{ readonly scopeId: string; readonly deps: HistoryDependencies }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'no-store' };
export function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  const safe = JSON.parse(JSON.stringify(body, (_key, value) => typeof value === 'string' ? redactSourceCredentials(value) : value));
  return Response.json(safe, { status, headers: { ...headers, ...extra } });
}
export function localOrigin(request: Request): boolean {
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false;
  const host = request.headers.get('host');
  if (host && !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(host)) return false;
  const origin = request.headers.get('origin');
  try {
    const authority = host ? new URL(`${url.protocol}//${host}`) : url;
    return !origin || new URL(origin).origin === authority.origin;
  }
  catch { return false; }
}
export async function bodyOf(request: Request, maxBytes = 1_000_000): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw Error('BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw Error('INVALID_BODY');
  const parts: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      try { await reader.cancel(); } catch { /* Cancellation failure must not hide the bounded-body error. */ }
      throw Error('BODY_TOO_LARGE');
    }
    parts.push(value);
  }
  let data: unknown;
  try {
    const merged = new Uint8Array(size); let offset = 0;
    for (const part of parts) { merged.set(part, offset); offset += part.byteLength; }
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(merged));
  } catch { throw Error('INVALID_JSON'); }
  if (typeof data !== 'object' || !data || Array.isArray(data)) throw Error('INVALID_BODY');
  return data as Record<string, unknown>;
}
function inputOf(body: Record<string, unknown>): BackfillInput {
  if (typeof body.fromCycle !== 'string' || typeof body.toCycle !== 'string' || !Array.isArray(body.rounds)) throw Error('INVALID_BACKFILL_INPUT');
  let fromCycle, toCycle;
  try { fromCycle = parseYearMonth(body.fromCycle); toCycle = parseYearMonth(body.toCycle); }
  catch { throw Error('INVALID_MONTH'); }
  try { ledgerOf(body.rounds); }
  catch { throw Error('INVALID_ROUNDS'); }
  return { fromCycle, toCycle, rounds: body.rounds };
}
function idOf(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw Error('INVALID_BATCH_ID');
  return value;
}
function errorResponse(error: unknown): Response {
  if (error instanceof BackfillRetryError) return json({ ok: false, code: error.reason, retryAfterSeconds: 1 }, 202, { 'Retry-After': '1' });
  const code = error instanceof Error ? error.message : 'STORAGE_UNAVAILABLE';
  const status = code === 'BATCH_NOT_FOUND' ? 404 : code === 'BATCH_START_KEY_CONFLICT' || code === 'BATCH_STEP_CONFLICT' ? 409 :
    code === 'EVALUATION_ZONE_MISMATCH' || code === 'NO_REPORT_CYCLE' ? 422 :
    code === 'LIMIT_EXCEEDED' || code === 'BODY_TOO_LARGE' ? 413 :
    /^INVALID_/.test(code) ? 400 : 503;
  return json({ ok: false, code: status === 503 ? 'STORAGE_UNAVAILABLE' : code }, status, status === 503 ? { 'Retry-After': '1' } : undefined);
}
export async function handleBackfillPost(request: Request, provider: Provider): Promise<Response> {
  try {
    if (!localOrigin(request)) return json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403);
    const body = await bodyOf(request);
    if (body.action === 'plan') return json({ ok: true, plan: planBackfill(inputOf(body)) });
    const { scopeId, deps } = await provider();
    if (body.action === 'start') {
      const input = inputOf(body);
      if (typeof body.startKey !== 'string') throw Error('INVALID_START_KEY');
      return json({ ok: true, batch: await startBackfill(deps, { ...input, scopeId, startKey: body.startKey }) });
    }
    if (body.action === 'step') return json({ ok: true, batch: await runBackfillStep(deps, scopeId, idOf(body.batchId)) });
    throw Error('INVALID_ACTION');
  } catch (error) { return errorResponse(error); }
}
export async function handleBackfillGet(request: Request, provider: Provider): Promise<Response> {
  try {
    if (!localOrigin(request)) return json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403);
    const { scopeId, deps } = await provider();
    const url = new URL(request.url);
    if (url.searchParams.get('active') === '1') return json({ ok: true, batches: await deps.repository.listBatches(scopeId, 'active', 20) });
    if (url.searchParams.get('all') === '1') return json({ ok: true, batches: await deps.repository.listBatches(scopeId, 'all', 20) });
    const batchId = idOf(url.searchParams.get('batchId'));
    const batch = await deps.repository.getBatch(scopeId, batchId);
    if (!batch) throw Error('BATCH_NOT_FOUND');
    return json({ ok: true, batch });
  } catch (error) { return errorResponse(error); }
}
