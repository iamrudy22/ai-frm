import { createManualEntry, saveManualEntry, getManualEntry, listManualEntries, prepareManualEntry, confirmManualEntry, type ManualEntryDependencies } from '@/application/report-history/manual-entry';
import { HistoryOperationError } from '@/application/report-history/ports';
import type { ManualEntryContentV1 } from '@/domain/report-history/manual-entry';
import { parseYearMonth } from '@/domain/shared/year-month';
import { bodyOf, json, localOrigin } from './report-history-handlers';

export type ManualEntryProvider = () => Promise<{ readonly scopeId: string; readonly deps: ManualEntryDependencies }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (): never => { throw Error('INVALID_MANUAL_ENTRY_REQUEST'); };
function exact(value: Record<string, unknown>, keys: readonly string[]) { if (Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) fail(); }
function id(value: unknown): string { if (typeof value !== 'string' || !uuid.test(value)) return fail(); return value; }
function revision(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return fail(); return value; }
function hash(value: unknown): string { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) return fail(); return value; }
function query(request: Request) {
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of new URL(request.url).searchParams) { if (Object.hasOwn(result, key)) return fail(); result[key] = value; }
  return result;
}
function content(value: unknown): ManualEntryContentV1 {
  // Catalog-dependent shape validation belongs to the service/domain. Bound raw wire sizes here.
  const visit = (node: unknown) => {
    if (typeof node === 'string' && node.length > 2000) throw Error('LIMIT_EXCEEDED');
    if (Array.isArray(node)) { if (node.length > 31) throw Error('LIMIT_EXCEEDED'); node.forEach(visit); }
    else if (node && typeof node === 'object') Object.values(node).forEach(visit);
  };
  visit(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as ManualEntryContentV1;
}
export function manualEntryFailure(error: unknown): Response {
  const code = error instanceof HistoryOperationError ? error.code : error instanceof Error ? error.message : '';
  const status = code === 'NOT_FOUND' ? 404
    : ['STALE_DRAFT', 'STALE_DEPENDENCY', 'REPORT_ALREADY_EXISTS', 'IDEMPOTENCY_KEY_REUSED', 'WORK_CLOSED'].includes(code) ? 409
    : ['BODY_TOO_LARGE', 'LIMIT_EXCEEDED'].includes(code) ? 413
    : ['INVALID_MANUAL_ENTRY_REQUEST', 'INVALID_DRAFT', 'INVALID_BODY', 'INVALID_JSON', 'UNSUPPORTED_VERSION', 'EVALUATION_ZONE_MISMATCH'].includes(code) ? 422 : 503;
  return json({ ok: false, code: status === 503 ? 'STORAGE_UNAVAILABLE' : code }, status, status === 503 ? { 'Retry-After': '1' } : undefined);
}
async function guarded(request: Request, run: () => Promise<Response>) {
  try {
    if (!localOrigin(request)) return json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403);
    return await run();
  } catch (error) { return manualEntryFailure(error); }
}
export function handleManualEntryGet(request: Request, provider: ManualEntryProvider): Promise<Response> {
  return guarded(request, async () => {
    const params = query(request);
    if (Object.hasOwn(params, 'draftId')) {
      exact(params, ['draftId']); const draftId = id(params.draftId), { scopeId, deps } = await provider();
      return json({ ok: true, draft: await getManualEntry(deps, scopeId, draftId) });
    }
    exact(params, Object.hasOwn(params, 'cursor') ? ['limit', 'cursor'] : ['limit']);
    if (params.limit !== '12' || (params.cursor !== undefined && (!params.cursor || params.cursor.length > 2000))) return fail();
    const { scopeId, deps } = await provider();
    return json({ ok: true, ...await listManualEntries(deps, scopeId, { limit: 12, ...(params.cursor !== undefined ? { cursor: params.cursor } : {}) }) });
  });
}
export function handleManualEntryPost(request: Request, provider: ManualEntryProvider): Promise<Response> {
  return guarded(request, async () => {
    exact(query(request), []);
    const body = await bodyOf(request, 6 * 1024 * 1024);
    if (body.action === 'create') {
      exact(body, ['action', 'reportTitleMonth', 'idempotencyKey']);
      const idempotencyKey = id(body.idempotencyKey);
      let reportTitleMonth; try { if (typeof body.reportTitleMonth !== 'string') return fail(); reportTitleMonth = parseYearMonth(body.reportTitleMonth); } catch { return fail(); }
      const { scopeId, deps } = await provider();
      return json({ ok: true, draft: await createManualEntry(deps, scopeId, { reportTitleMonth, idempotencyKey }) });
    }
    if (body.action === 'save') {
      exact(body, ['action', 'draftId', 'expectedDraftRevision', 'idempotencyKey', 'content']);
      const command = { draftId: id(body.draftId), expectedDraftRevision: revision(body.expectedDraftRevision), idempotencyKey: id(body.idempotencyKey), content: content(body.content) };
      const { scopeId, deps } = await provider(); return json({ ok: true, draft: await saveManualEntry(deps, scopeId, command) });
    }
    if (body.action === 'prepare') {
      exact(body, ['action', 'draftId', 'expectedDraftRevision', 'idempotencyKey']);
      const command = { draftId: id(body.draftId), expectedDraftRevision: revision(body.expectedDraftRevision), idempotencyKey: id(body.idempotencyKey) };
      const { scopeId, deps } = await provider(), result = await prepareManualEntry(deps, scopeId, command);
      return result.kind === 'invalid' ? json({ ok: false, code: 'INVALID_MANUAL_ENTRY', errors: result.errors }, 422) : json({ ok: true, result });
    }
    if (body.action === 'confirm') {
      exact(body, ['action', 'draftId', 'expectedDraftRevision', 'candidateId', 'documentHash', 'expectedRevision', 'idempotencyKey']);
      if (body.expectedRevision !== 0) return fail();
      const command = { draftId: id(body.draftId), expectedDraftRevision: revision(body.expectedDraftRevision), candidateId: id(body.candidateId), documentHash: hash(body.documentHash), expectedRevision: 0 as const, idempotencyKey: id(body.idempotencyKey) };
      const { scopeId, deps } = await provider(), result = await confirmManualEntry(deps, scopeId, command);
      return json({ ok: result.kind === 'confirmed' || result.kind === 'already-confirmed', result }, result.kind === 'conflict' ? 409 : result.kind === 'not-ready' ? 422 : 200);
    }
    return fail();
  });
}
