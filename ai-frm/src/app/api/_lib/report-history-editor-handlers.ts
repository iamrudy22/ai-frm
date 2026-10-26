import { prepareCorrectionEditor, previewCorrectionDraft } from '@/application/report-history/report-correction';
import { closeCorrectionWork, copyClosedCorrectionWork, createCorrectionDraft, getCorrectionDraft, getCorrectionReviewDetail, listCorrectionMonths, listCorrectionWork, reapplyCorrectionDraft, saveCorrectionDraft } from '@/application/report-history/correction-work';
import { HistoryOperationError, type CorrectionDependencies } from '@/application/report-history/ports';
import type { CorrectionWorkRef, DraftContent, DraftEdit } from '@/domain/report-history/correction';
import { parseYearMonth } from '@/domain/shared/year-month';
import { bodyOf, json, localOrigin } from './report-history-handlers';

export type CorrectionProvider = () => Promise<{ readonly scopeId: string; readonly deps: CorrectionDependencies }>;
const BODY_LIMIT = 6 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (): never => { throw Error('INVALID_CORRECTION_REQUEST'); };
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function exact(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).length !== fields.length || !fields.every(key => Object.hasOwn(value, key))) fail();
}
function text(value: unknown): string {
  if (typeof value !== 'string') return fail();
  if (value.length > 2000) throw Error('LIMIT_EXCEEDED');
  return value;
}
function id(value: unknown): string { const result = text(value); if (!uuid.test(result)) return fail(); return result; }
function revision(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return fail(); return value; }
function ref(value: unknown): CorrectionWorkRef {
  exact(value, ['kind', 'id']);
  if (value.kind !== 'draft' && value.kind !== 'legacy-preview') return fail();
  return { kind: value.kind, id: id(value.id) };
}
function content(value: unknown): DraftContent {
  exact(value, ['edits', 'reason', 'evidenceNote']);
  if (!Array.isArray(value.edits)) return fail();
  if (value.edits.length > 10000) throw Error('LIMIT_EXCEEDED');
  const edits = value.edits.map((edit): DraftEdit => {
    exact(edit, ['rowId', 'action', 'rawValue']);
    const rowId = text(edit.rowId);
    if (!rowId || (edit.action !== 'set' && edit.action !== 'set-missing')) return fail();
    const rawValue = edit.rawValue === null ? null : text(edit.rawValue);
    if ((edit.action === 'set' && rawValue === null) || (edit.action === 'set-missing' && rawValue !== null && rawValue !== '')) return fail();
    return { rowId, action: edit.action, rawValue };
  });
  return { edits, reason: text(value.reason), evidenceNote: text(value.evidenceNote) };
}

/** Only public, known error codes cross this boundary. Never send Error.message verbatim. */
export function correctionFailure(error: unknown): Response {
  const code = error instanceof HistoryOperationError ? error.code : error instanceof Error ? error.message : '';
  const status = code === 'NOT_FOUND' ? 404
    : ['STALE_BASE', 'STALE_DEPENDENCY', 'STALE_DRAFT', 'WORK_CLOSED', 'IDEMPOTENCY_KEY_REUSED'].includes(code) ? 409
    : ['BODY_TOO_LARGE', 'LIMIT_EXCEEDED'].includes(code) ? 413
    : ['INVALID_CORRECTION_REQUEST', 'INVALID_CORRECTION_COMMAND', 'INVALID_BODY', 'INVALID_JSON', 'INVALID_DRAFT', 'UNSUPPORTED_VERSION', 'EVALUATION_ZONE_MISMATCH'].includes(code) ? 422 : 503;
  return json({ ok: false, code: status === 503 ? 'STORAGE_UNAVAILABLE' : code }, status, status === 503 ? { 'Retry-After': '1' } : undefined);
}
async function guarded(request: Request, action: () => Promise<Response>): Promise<Response> {
  try {
    if (!localOrigin(request)) return json({ ok: false, code: 'LOCAL_ORIGIN_REQUIRED' }, 403);
    return await action();
  } catch (error) { return correctionFailure(error); }
}
function query(request: Request): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (Object.hasOwn(result, key)) return fail();
    Object.defineProperty(result, key, { value, enumerable: true });
  }
  return result;
}
async function postBody(request: Request) {
  exact(query(request), []);
  return bodyOf(request, BODY_LIMIT);
}
function queryKeys(value: Record<string, string>, required: readonly string[], optional: readonly string[] = []) {
  if (!required.every(key => Object.hasOwn(value, key)) || !Object.keys(value).every(key => required.includes(key) || optional.includes(key))) fail();
}
function pending(value: string): boolean { if (value !== 'true' && value !== 'false') return fail(); return value === 'true'; }
function month(value: string): string { try { return parseYearMonth(value); } catch { return fail(); } }
function cursor(value: string): string { if (!text(value)) return fail(); return value; }

export function handleEditorPost(request: Request, provider: CorrectionProvider): Promise<Response> {
  return guarded(request, async () => {
    const body = await postBody(request);
    if (body.action === 'open') {
      exact(body, ['action', 'confirmationId']);
      const confirmationId = id(body.confirmationId), { scopeId, deps } = await provider();
      return json({ ok: true, editor: await prepareCorrectionEditor(deps, scopeId, confirmationId) });
    }
    if (body.action === 'preview') {
      exact(body, ['action', 'draftId', 'expectedDraftRevision']);
      const cmd = { draftId: id(body.draftId), expectedDraftRevision: revision(body.expectedDraftRevision) };
      const { scopeId, deps } = await provider(), result = await previewCorrectionDraft(deps, scopeId, cmd);
      return result.kind === 'invalid' ? json({ ok: false, code: 'INVALID_CORRECTION', errors: result.errors }, 422) : json({ ok: true, result });
    }
    return fail();
  });
}
export function handleDraftsPost(request: Request, provider: CorrectionProvider): Promise<Response> {
  return guarded(request, async () => {
    const body = await postBody(request);
    if (body.action === 'create') {
      exact(body, ['action', 'basisId', 'idempotencyKey', 'content']);
      const cmd = { basisId: id(body.basisId), idempotencyKey: id(body.idempotencyKey), content: content(body.content) };
      const { scopeId, deps } = await provider(), draft = await createCorrectionDraft(deps, scopeId, cmd);
      return draft === 'empty' ? json({ ok: true, result: { kind: 'empty' } }) : json({ ok: true, draft });
    }
    if (body.action === 'save') {
      exact(body, ['action', 'draftId', 'expectedDraftRevision', 'idempotencyKey', 'content']);
      const cmd = { draftId: id(body.draftId), expectedDraftRevision: revision(body.expectedDraftRevision), idempotencyKey: id(body.idempotencyKey), content: content(body.content) };
      const { scopeId, deps } = await provider();
      return json({ ok: true, draft: await saveCorrectionDraft(deps, scopeId, cmd) });
    }
    return fail();
  });
}
export function handleDraftsGet(request: Request, provider: CorrectionProvider): Promise<Response> {
  return guarded(request, async () => {
    const params = query(request); exact(params, ['draftId']);
    const draftId = id(params.draftId), { scopeId, deps } = await provider();
    return json({ ok: true, draft: await getCorrectionDraft(deps.repository, scopeId, draftId) });
  });
}
export function handleReviewsGet(request: Request, provider: CorrectionProvider): Promise<Response> {
  return guarded(request, async () => {
    const params = query(request);
    if (Object.hasOwn(params, 'refKind') || Object.hasOwn(params, 'refId')) {
      exact(params, ['refKind', 'refId']);
      const reference = ref({ kind: params.refKind, id: params.refId }), { scopeId, deps } = await provider();
      return json({ ok: true, detail: await getCorrectionReviewDetail(deps.repository, scopeId, reference) });
    }
    if (Object.hasOwn(params, 'view')) {
      queryKeys(params, ['view', 'pendingOnly', 'limit'], ['fromCycle', 'toCycle', 'cursor']);
      if (params.view !== 'months' || params.limit !== '12') return fail();
      const q = { pendingOnly: pending(params.pendingOnly), limit: 12 as const, ...(params.fromCycle !== undefined ? { fromCycle: month(params.fromCycle) } : {}), ...(params.toCycle !== undefined ? { toCycle: month(params.toCycle) } : {}), ...(params.cursor !== undefined ? { cursor: cursor(params.cursor) } : {}) };
      if (q.fromCycle && q.toCycle && q.fromCycle > q.toCycle) return fail();
      const { scopeId, deps } = await provider();
      return json({ ok: true, ...await listCorrectionMonths(deps.repository, scopeId, q) });
    }
    queryKeys(params, ['pendingOnly', 'limit'], ['reportCycle', 'cursor']);
    if (params.limit !== '20') return fail();
    const q = { pendingOnly: pending(params.pendingOnly), limit: 20 as const, ...(params.reportCycle !== undefined ? { reportCycle: month(params.reportCycle) } : {}), ...(params.cursor !== undefined ? { cursor: cursor(params.cursor) } : {}) };
    const { scopeId, deps } = await provider();
    return json({ ok: true, ...await listCorrectionWork(deps.repository, scopeId, q) });
  });
}
export function handleReviewsPost(request: Request, provider: CorrectionProvider): Promise<Response> {
  return guarded(request, async () => {
    const body = await postBody(request);
    if (body.action === 'close') {
      exact(body, ['action', 'ref', 'expectedDraftRevision', 'idempotencyKey']);
      const reference = ref(body.ref), expectedDraftRevision = reference.kind === 'draft' ? revision(body.expectedDraftRevision) : body.expectedDraftRevision === null ? null : fail();
      const cmd = { ref: reference, expectedDraftRevision, idempotencyKey: id(body.idempotencyKey) }, { scopeId, deps } = await provider();
      return json({ ok: true, result: await closeCorrectionWork(deps, scopeId, cmd) });
    }
    if (body.action === 'copy') {
      exact(body, ['action', 'ref', 'idempotencyKey']);
      const cmd = { ref: ref(body.ref), idempotencyKey: id(body.idempotencyKey) }, { scopeId, deps } = await provider();
      return json({ ok: true, result: await copyClosedCorrectionWork(deps, scopeId, cmd) });
    }
    if (body.action === 'reapply') {
      exact(body, ['action', 'draftId', 'expectedDraftRevision', 'expectedLatestConfirmationId', 'idempotencyKey']);
      const cmd = { draftId: id(body.draftId), expectedDraftRevision: revision(body.expectedDraftRevision), expectedLatestConfirmationId: id(body.expectedLatestConfirmationId), idempotencyKey: id(body.idempotencyKey) }, { scopeId, deps } = await provider();
      return json({ ok: true, result: await reapplyCorrectionDraft(deps, scopeId, cmd) });
    }
    return fail();
  });
}
