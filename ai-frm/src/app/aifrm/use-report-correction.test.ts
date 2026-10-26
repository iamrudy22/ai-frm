import { afterEach, expect, it, vi } from 'vitest';
import { CorrectionSession, CorrectionClientError, createCorrectionClient } from './use-report-correction';
import type { CorrectionEditorDto, CorrectionDraftDto } from '@/domain/report-history/correction';
const editor = { basisId: 'basis', baseConfirmationId: 'head', baseRevision: 1, basis: { reportCycle: '2026/01', reportTitleMonth: '2025/12' }, rows: [] } as unknown as CorrectionEditorDto;
const dto = (content: CorrectionDraftDto['content'], revision = 1): CorrectionDraftDto => ({ draftId: 'same', draftRevision: revision, editor, content, createdAt: 'date', savedAt: 'date', currentPreviewId: null, requiresReapply: false });
const defer = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
afterEach(() => vi.useRealTimers());
it('autosave_debounces_1000ms_and_serializes_writes; create_before_ack_coalesces_to_one_draft; late_ack_advances_queue_revision_without_replacing_new_text', async () => {
  vi.useFakeTimers();
  const first = defer<CorrectionDraftDto>();
  const create = vi.fn(() => first.promise);
  const save = vi.fn(async (cmd) => dto(cmd.content, 2));
  const session = new CorrectionSession(editor, null, { create, save } as never, () => 'key');
  session.change({ ...session.snapshot.content, reason: '원' });
  await vi.advanceTimersByTimeAsync(999);
  expect(create).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(create).toHaveBeenCalledTimes(1);
  session.change({ ...session.snapshot.content, reason: '최신' });
  await vi.advanceTimersByTimeAsync(1000);
  expect(save).not.toHaveBeenCalled();
  first.resolve(dto({ edits: [], reason: '원', evidenceNote: '' }));
  await session.drain();
  expect(create).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0]).toMatchObject({ draftId: 'same', expectedDraftRevision: 1, content: { reason: '최신' } });
  expect(session.snapshot.content.reason).toBe('최신');
  expect(session.snapshot.saveStatus).toBe('saved');
});
it('failed_save_keeps_text_and_requires_retry of SAME key payload BEFORE next revision; leave_and_preview_wait_for_ack', async () => {
  vi.useFakeTimers();
  const requests: unknown[] = [];
  let fail = true;
  const save = vi.fn(async (cmd) => {
    requests.push(cmd);
    if (fail)
      throw Error('offline');
    return dto(cmd.content, cmd.expectedDraftRevision + 1);
  });
  const session = new CorrectionSession(editor, dto({ edits: [], reason: 'old', evidenceNote: '' }), { save } as never, () => crypto.randomUUID());
  session.change({ ...session.snapshot.content, reason: 'first' });
  await vi.advanceTimersByTimeAsync(1000);
  session.change({ ...session.snapshot.content, reason: 'second' });
  await vi.advanceTimersByTimeAsync(1000);
  await expect(session.drain()).rejects.toThrow();
  expect(save).toHaveBeenCalledTimes(1);
  expect(session.snapshot.content.reason).toBe('second');
  fail = false;
  await session.retry();
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[2]).toMatchObject({ expectedDraftRevision: 2, content: { reason: 'second' } });
  expect(session.hasUnacknowledged).toBe(false);
});
it('edit_invalidates_preview_and_confirmation_command and uncertain confirm retries original command', async () => {
  const commands: unknown[] = [];
  let fails = true;
  const client = { detail: async () => comparisonDetail(), preview: vi.fn(async () => ({ kind: 'preview', previewId: 'p', previewHash: 'hash', draftRevision: 1 })), confirm: vi.fn(async (cmd) => {
      commands.push(cmd);
      if (fails)
        throw Error('unknown');
      return { kind: 'confirmed', confirmationId: 'done', revision: 2 };
    }) };
  const session = new CorrectionSession(editor, dto({ edits: [{ rowId: 'a', action: 'set', rawValue: '2' }], reason: '사유', evidenceNote: '' }), client as never, () => 'click');
  await session.preview();
  expect(session.canConfirm).toBe(true);
  await expect(session.confirm()).rejects.toThrow();
  fails = false;
  await session.confirm();
  expect(commands[1]).toEqual(commands[0]);
  const editing = new CorrectionSession(editor, dto({ edits: [], reason: '사유', evidenceNote: '' }), client as never, () => 'new');
  await editing.preview();
  editing.change({ ...editing.snapshot.content, reason: '다른 사유' });
  expect(editing.snapshot.preview).toBeNull();
  expect(editing.canConfirm).toBe(false);
  editing.dispose();
});
it('late_ack_cannot_replace_other_month and readonly_view_never_autosaves', async () => {
  const first = defer<CorrectionDraftDto>();
  const client = { create: vi.fn(() => first.promise), save: vi.fn() };
  const a = new CorrectionSession(editor, null, client as never, () => 'a');
  a.change({ ...a.snapshot.content, reason: 'A' });
  const draining = a.drain();
  const b = new CorrectionSession({ ...editor, basisId: 'B' }, null, client as never, () => 'b');
  first.resolve(dto({ edits: [], reason: 'A', evidenceNote: '' }));
  await draining;
  expect(b.snapshot.content.reason).toBe('');
  expect(b.snapshot.editor.basisId).toBe('B');
  expect(client.save).not.toHaveBeenCalled();
});
it('client keeps exact W4 envelopes and explicit query limits without exchange', async () => {
  const request = vi.fn(async (...args: [
    string,
    RequestInit?
  ]) => { void args; return Response.json({ ok: true, items: [], nextCursor: null }); });
  const client = createCorrectionClient(request as never);
  await client.months({ pendingOnly: false });
  await client.work({ reportCycle: '2026/01', pendingOnly: true, cursor: 'opaque' });
  expect(request.mock.calls[0][0]).toContain('pendingOnly=false');
  expect(request.mock.calls[0][0]).toContain('limit=12');
  expect(request.mock.calls[1][0]).toContain('limit=20');
});
it('leave_and_preview_wait_for_ack use exact acknowledged revision and preserve latest reason', async () => {
  const ack = defer<CorrectionDraftDto>();
  const preview = vi.fn(async () => ({ kind: 'preview', previewId: 'p', previewHash: 'hash', draftRevision: 2 }));
  const session = new CorrectionSession(editor, dto({ edits: [], reason: 'old', evidenceNote: '' }), { save: () => ack.promise, preview, detail: async () => comparisonDetail(2) } as never);
  session.change({ ...session.snapshot.content, reason: 'new' });
  const reviewed = session.preview();
  expect(preview).not.toHaveBeenCalled();
  ack.resolve(dto({ edits: [], reason: 'new', evidenceNote: '' }, 2));
  await reviewed;
  expect(preview).toHaveBeenCalledWith('same', 2);
  expect(session.canConfirm).toBe(true);
});
it('create lost response retries same request before the newer coalesced content and never creates a second draft', async () => {
  const commands: unknown[] = [];
  let fail = true;
  const create = vi.fn(async (cmd) => {
    commands.push(cmd);
    if (fail)
      throw Error('lost');
    return dto(cmd.content);
  });
  const save = vi.fn(async (cmd) => dto(cmd.content, 2));
  const session = new CorrectionSession(editor, null, { create, save } as never, () => crypto.randomUUID());
  session.change({ ...session.snapshot.content, reason: 'first' });
  await expect(session.drain()).rejects.toThrow();
  session.change({ ...session.snapshot.content, reason: 'latest' });
  fail = false;
  await session.retry();
  expect(commands[1]).toEqual(commands[0]);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ draftId: 'same', expectedDraftRevision: 1, content: expect.objectContaining({ reason: 'latest' }) }));
  expect(session.snapshot.content.reason).toBe('latest');
});
it('invalid, no-change, stale and copied proposal never enable confirmation', async () => {
  for (const result of [{ kind: 'no-change' }, { kind: 'invalid', errors: [{ rowId: null, field: 'reason', code: 'REQUIRED_REASON', message: '사유' }] }, { kind: 'preview', draftRevision: 99, previewId: 'old', previewHash: 'hash' }]) {
    const session = new CorrectionSession(editor, dto({ edits: [], reason: 'why', evidenceNote: '' }), { preview: async () => result } as never);
    await session.preview();
    expect(session.canConfirm).toBe(false);
  }
  const preview = vi.fn();
  const copied = new CorrectionSession(editor, { ...dto({ edits: [], reason: '', evidenceNote: '' }), requiresReapply: true }, { preview } as never);
  await copied.preview();
  expect(preview).not.toHaveBeenCalled();
  copied.change({ edits: [], reason: 'injected', evidenceNote: '' });
  expect(copied.snapshot.content.reason).toBe('');
  const stale = new CorrectionSession(editor, dto({ edits: [], reason: 'old', evidenceNote: '' }), { preview } as never);
  stale.markStale();
  await stale.preview();
  expect(preview).not.toHaveBeenCalled();
  expect(stale.canConfirm).toBe(false);
});
it('reason, note, raw zero and full precision changes invalidate current preview without mutating stored preview', async () => {
  const stored = { kind: 'preview', previewId: 'p', previewHash: 'h', draftRevision: 1 };
  for (const patch of [{ reason: 'new' }, { evidenceNote: 'new' }, { edits: [{ rowId: 'r', action: 'set', rawValue: '0' }] }, { edits: [{ rowId: 'r', action: 'set-missing', rawValue: null }] }]) {
    const session = new CorrectionSession(editor, dto({ edits: [], reason: 'old', evidenceNote: '' }), { preview: async () => stored, detail: async () => comparisonDetail(1, 'h') } as never);
    await session.preview();
    session.change({ ...session.snapshot.content, ...patch } as never);
    expect(session.snapshot.preview).toBeNull();
    expect(session.canConfirm).toBe(false);
    expect(stored.previewId).toBe('p');
    session.dispose();
  }
});
it('HTTP invalid422 keeps field errors; all mutations use exact actions and no-store', async () => {
  const calls: {
    url: string;
    init?: RequestInit;
  }[] = [];
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (calls.length === 1)
      return Response.json({ ok: false, code: 'INVALID_CORRECTION', errors: [{ field: 'value', rowId: 'r', code: 'INVALID_NUMBER', message: '수정 값' }] }, { status: 422 });
    return Response.json({ ok: true, draft: dto({ edits: [], reason: '', evidenceNote: '' }), editor, detail: {}, result: { kind: 'no-change' } });
  });
  const client = createCorrectionClient(request as never);
  await expect(client.preview('same', 2)).rejects.toMatchObject({ status: 422, errors: [{ rowId: 'r', message: '수정 값' }] });
  await client.open('head');
  await client.resume('same');
  await client.detail({ kind: 'draft', id: 'same' });
  await client.reapply({ draftId: 'same', expectedDraftRevision: 2, expectedLatestConfirmationId: 'compared-head', idempotencyKey: 'key' });
  expect(JSON.parse(calls[4].init!.body as string)).toEqual({ action: 'reapply', draftId: 'same', expectedDraftRevision: 2, expectedLatestConfirmationId: 'compared-head', idempotencyKey: 'key' });
  expect(calls.every(call => call.init?.cache === 'no-store')).toBe(true);
  expect(calls.some(call => call.url.includes('exchange'))).toBe(false);
});
it('2000 character transport boundary does not truncate or poison the retry queue', () => {
  const session = new CorrectionSession(editor, null, {} as never);
  const allowed = '가'.repeat(2000);
  session.change({ ...session.snapshot.content, reason: allowed });
  session.change({ ...session.snapshot.content, reason: allowed + '초과' });
  expect(session.snapshot.content.reason).toBe(allowed);
  expect(session.snapshot.errors[0].code).toBe('LIMIT_EXCEEDED');
  session.dispose();
});
it('rejected overlength input is an error and cannot retain an actionable preview', async () => {
  const session = new CorrectionSession(editor, dto({ edits: [], reason: 'valid', evidenceNote: '' }), { preview: async () => ({ kind: 'preview', previewId: 'p', previewHash: 'h', draftRevision: 1 }), detail: async () => comparisonDetail(1, 'h') } as never);
  await session.preview();
  expect(session.canConfirm).toBe(true);
  session.change({ ...session.snapshot.content, reason: '가'.repeat(2001) });
  expect(session.canConfirm).toBe(false);
  expect(session.snapshot.preview).toBeNull();
});
it('automatic save waits 1000ms after LAST input even when the previous ACK arrives early', async () => {
  vi.useFakeTimers();
  const first = defer<CorrectionDraftDto>();
  const create = vi.fn(() => first.promise);
  const save = vi.fn(async (cmd) => dto(cmd.content, 2));
  const session = new CorrectionSession(editor, null, { create, save } as never);
  session.change({ ...session.snapshot.content, reason: 'first' });
  await vi.advanceTimersByTimeAsync(1000);
  await vi.advanceTimersByTimeAsync(100);
  session.change({ ...session.snapshot.content, reason: 'last' });
  await vi.advanceTimersByTimeAsync(100);
  first.resolve(dto({ edits: [], reason: 'first', evidenceNote: '' }));
  await vi.advanceTimersByTimeAsync(0);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(899);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].content.reason).toBe('last');
});
it('definite409 stops same-command retry, keeps local proposal, and only explicit reviewed choice accepts latest', async () => {
  const latest = dto({ edits: [], reason: 'other tab', evidenceNote: 'server' }, 4);
  const detail = { summary: { state: 'draft', capabilities: { resume: true } }, rows: [], reason: 'other tab', evidenceNote: 'server' };
  const save = vi.fn(async () => { throw new CorrectionClientError(409, 'STALE_DRAFT'); });
  const resume = vi.fn(async () => latest);
  const session = new CorrectionSession(editor, dto({ edits: [], reason: 'start', evidenceNote: '' }), { save, resume, detail: async () => detail } as never);
  session.change({ ...session.snapshot.content, reason: 'my local proposal' });
  await expect(session.drain()).rejects.toMatchObject({ status: 409 });
  expect(session.snapshot.saveStatus).toBe('conflict');
  await expect(session.retry()).rejects.toThrow();
  expect(save).toHaveBeenCalledTimes(1);
  await session.readConflictLatest();
  expect(session.snapshot.content.reason).toBe('my local proposal');
  expect(session.hasUnacknowledged).toBe(true);
  expect(session.snapshot.conflict?.latest?.draft?.draftRevision).toBe(4);
  session.acceptConflictLatest();
  expect(session.snapshot.content.reason).toBe('other tab');
  expect(session.hasUnacknowledged).toBe(false);
  await session.drain();
  expect(save).toHaveBeenCalledTimes(1);
});
it('create head409 recovery reads latest basis intentionally without remapping local rows or writing a new draft', async () => {
  const current = { ...editor, basisId: 'new-basis', baseConfirmationId: 'new-head', baseRevision: 2 };
  const create = vi.fn(async () => { throw new CorrectionClientError(409, 'STALE_BASE'); });
  const open = vi.fn(async () => current);
  const session = new CorrectionSession(editor, null, { create, months: async () => ({ items: [{ reportCycle: '2026/01', latestConfirmationId: 'new-head' }] }), open } as never);
  session.change({ edits: [{ rowId: 'old-row', action: 'set', rawValue: '0' }], reason: 'mine', evidenceNote: '' });
  await expect(session.drain()).rejects.toThrow();
  await session.readConflictLatest();
  expect(open).toHaveBeenCalledWith('new-head');
  expect(session.snapshot.content.edits[0].rowId).toBe('old-row');
  session.acceptConflictLatest();
  expect(session.snapshot.editor.basisId).toBe('new-basis');
  expect(session.snapshot.content.edits).toEqual([]);
  expect(create).toHaveBeenCalledTimes(1);
  await session.drain();
});
it.each(['closed', 'confirmed', 'reflected'])('conflict latest %s is read only after explicit recovery', async (state) => {
  const save = vi.fn(async () => { throw new CorrectionClientError(409, 'WORK_CLOSED'); });
  const session = new CorrectionSession(editor, dto({ edits: [], reason: 'start', evidenceNote: '' }), { save, resume: async () => dto({ edits: [], reason: 'completed', evidenceNote: '' }, 3), detail: async () => ({ summary: { state, capabilities: { resume: false } } }) } as never);
  session.change({ ...session.snapshot.content, reason: 'local' });
  await expect(session.drain()).rejects.toThrow();
  await session.readConflictLatest();
  session.acceptConflictLatest();
  session.change({ ...session.snapshot.content, reason: 'overwrite' });
  expect(session.snapshot.content.reason).toBe('completed');
  expect(session.snapshot.completed).toBe(true);
  expect(session.canConfirm).toBe(false);
  await session.drain();
  expect(save).toHaveBeenCalledTimes(1);
});
it('explicit drain bypasses the remaining debounce deadline while automatic ACK still stays serialized', async () => {
  vi.useFakeTimers();
  const ack = defer<CorrectionDraftDto>();
  const save = vi.fn(async (cmd) => dto(cmd.content, 2));
  const session = new CorrectionSession(editor, null, { create: () => ack.promise, save } as never);
  session.change({ ...session.snapshot.content, reason: 'first' });
  await vi.advanceTimersByTimeAsync(1000);
  await vi.advanceTimersByTimeAsync(100);
  session.change({ ...session.snapshot.content, reason: 'last' });
  const leaving = session.drain();
  await vi.advanceTimersByTimeAsync(100);
  ack.resolve(dto({ edits: [], reason: 'first', evidenceNote: '' }));
  await leaving;
  expect(save).toHaveBeenCalledTimes(1);
  expect(session.hasUnacknowledged).toBe(false);
  session.dispose();
});
it('conflict lookup failure preserves local raw content and cannot authorize discard without a reviewed latest snapshot', async () => {
  const client = { save: async () => { throw new CorrectionClientError(409, 'STALE_DRAFT'); }, resume: async () => { throw Error('offline'); } };
  const session = new CorrectionSession(editor, dto({ edits: [], reason: 'start', evidenceNote: '' }), client as never);
  session.change({ ...session.snapshot.content, reason: 'my unsaved text' });
  await expect(session.drain()).rejects.toThrow();
  await expect(session.readConflictLatest()).rejects.toThrow();
  expect(session.snapshot.content.reason).toBe('my unsaved text');
  expect(() => session.acceptConflictLatest()).toThrow('CONFLICT_COMPARISON_REQUIRED');
  expect(session.hasUnacknowledged).toBe(true);
  session.dispose();
});
it('changing draft during conflict lookup rejects mixed comparison, retains local raw and requires explicit reread',async()=>{
 const revision2=dto({edits:[],reason:'server revision 2',evidenceNote:'two'},2);
 const revision3=dto({edits:[],reason:'server revision 3',evidenceNote:'three'},3);
 let current=revision2;let race=true;
 const save=vi.fn(async()=>{throw new CorrectionClientError(409,'STALE_DRAFT');});
 const resume=vi.fn(async()=>current);
 const detail=vi.fn(async()=>{if(race)current=revision3;return {summary:{state:'draft',capabilities:{resume:true}},rows:[],reason:current.content.reason,evidenceNote:current.content.evidenceNote};});
 const session=new CorrectionSession(editor,dto({edits:[],reason:'start',evidenceNote:''}),{save,resume,detail} as never);
 session.change({...session.snapshot.content,reason:'my local raw'});await expect(session.drain()).rejects.toThrow();
 await expect(session.readConflictLatest()).rejects.toMatchObject({code:'CONFLICT_CHANGED_DURING_READ'});
 expect(session.snapshot.conflict?.latest).toBeNull();expect(session.snapshot.content.reason).toBe('my local raw');expect(session.hasUnacknowledged).toBe(true);expect(()=>session.acceptConflictLatest()).toThrow('CONFLICT_COMPARISON_REQUIRED');expect(session.snapshot.message).toContain('다시 조회');
 expect(resume).toHaveBeenCalledTimes(2);expect(detail).toHaveBeenCalledTimes(1);expect(save).toHaveBeenCalledTimes(1);
 race=false;await session.readConflictLatest();
 expect(session.snapshot.conflict?.latest?.detail?.reason).toBe('server revision 3');expect(session.snapshot.conflict?.latest?.draft?.content.reason).toBe('server revision 3');
 session.acceptConflictLatest();expect(session.snapshot.content.reason).toBe('server revision 3');expect(session.snapshot.draft?.draftRevision).toBe(3);await session.drain();expect(save).toHaveBeenCalledTimes(1);
});
it('a changed basis with the same reported revision invalidates an earlier adoptable comparison',async()=>{
 let current=dto({edits:[],reason:'server stable',evidenceNote:''},2);let changedBasis=false;
 const save=vi.fn(async()=>{throw new CorrectionClientError(409,'STALE_DRAFT');});
 const session=new CorrectionSession(editor,dto({edits:[],reason:'start',evidenceNote:''}),{save,resume:async()=>current,detail:async()=>{if(changedBasis)current={...current,editor:{...current.editor,basisId:'new-basis'}};return {summary:{state:'draft',capabilities:{resume:true}},rows:[],reason:'server stable',evidenceNote:''};}} as never);
 session.change({...session.snapshot.content,reason:'my unsaved proposal'});await expect(session.drain()).rejects.toThrow();await session.readConflictLatest();expect(session.snapshot.conflict?.latest).not.toBeNull();
 changedBasis=true;await expect(session.readConflictLatest()).rejects.toMatchObject({code:'CONFLICT_CHANGED_DURING_READ'});expect(session.snapshot.conflict?.latest).toBeNull();expect(()=>session.acceptConflictLatest()).toThrow();expect(session.snapshot.content.reason).toBe('my unsaved proposal');expect(session.hasUnacknowledged).toBe(true);expect(save).toHaveBeenCalledTimes(1);
});

const comparisonDetail = (revision = 1, hash = 'hash', previewId = 'p') => ({
  summary: { ref: { kind: 'draft', id: 'same' }, state: 'pending', baseRevision: 1, capabilities: { resume: true } },
  preview: { previewId, previewHash: hash, draftRevision: revision, baseRevision: 1, rawDiff: [], resultDiff: [], affectedReports: [] },
});
it('confirmation waits for exact stored comparison and a failed read cannot authorize a write', async () => {
  const comparison = defer<ReturnType<typeof comparisonDetail>>();
  const client = { preview: vi.fn(async () => ({ kind: 'preview', previewId: 'p', previewHash: 'hash', draftRevision: 1 })), detail: vi.fn(() => comparison.promise), confirm: vi.fn() };
  const session = new CorrectionSession(editor, dto({ edits: [], reason: 'why', evidenceNote: '' }), client as never);
  const reviewing = session.preview();
  await vi.waitFor(() => expect(client.detail).toHaveBeenCalledTimes(1));
  expect(session.snapshot.preview).toBeNull(); expect(session.canConfirm).toBe(false);
  comparison.resolve(comparisonDetail()); await reviewing;
  expect(session.canConfirm).toBe(true); expect(session.snapshot).toHaveProperty('comparison.resultDiff', []);
  const failed = new CorrectionSession(editor, dto({ edits: [], reason: 'why', evidenceNote: '' }), { ...client, detail: async () => { throw Error('read failed'); } } as never);
  await failed.preview(); expect(failed.canConfirm).toBe(false); expect(failed.snapshot.preview).toBeNull();
  expect(client.confirm).not.toHaveBeenCalled();
});
it.each(['id', 'hash', 'revision', 'ref', 'closed', 'stale', 'missing', 'payload'])('stored comparison %s mismatch never enables confirmation', async mismatch => {
  const detail = comparisonDetail();
  if(mismatch === 'payload') detail.preview.resultDiff = null as never;
  if(mismatch === 'id') detail.preview.previewId = 'other';
  if(mismatch === 'hash') detail.preview.previewHash = 'other';
  if(mismatch === 'revision') detail.preview.draftRevision = 2;
  if(mismatch === 'ref') detail.summary.ref.id = 'other';
  if(mismatch === 'closed' || mismatch === 'stale') detail.summary.state = mismatch;
  const session = new CorrectionSession(editor, dto({ edits: [], reason: 'why', evidenceNote: '' }), { preview: async () => ({ kind: 'preview', previewId: 'p', previewHash: 'hash', draftRevision: 1 }), detail: async () => mismatch === 'missing' ? {...detail, preview: null} : detail } as never);
  await session.preview(); expect(session.canConfirm).toBe(false); expect(session.snapshot.preview).toBeNull();
});
it.each([422, 413])('definite %s rejection keeps raw and ACK but corrected content uses a new key once', async status => {
  const save = vi.fn().mockRejectedValueOnce(new CorrectionClientError(status, status === 413 ? 'LIMIT_EXCEEDED' : 'INVALID_DRAFT')).mockImplementation(async cmd => dto(cmd.content, 2));
  let key = 0;
  const session = new CorrectionSession(editor, dto({edits: [], reason: 'old', evidenceNote: ''}), {save} as never, () => `key-${++key}`);
  session.change({...session.snapshot.content, reason:'rejected'}); await expect(session.drain()).rejects.toMatchObject({status});
  expect(session.snapshot.content.reason).toBe('rejected'); expect(session.snapshot.draft?.draftRevision).toBe(1);
  session.change({...session.snapshot.content, reason:'corrected'}); await session.drain();
  expect(save).toHaveBeenCalledTimes(2); expect(save.mock.calls[1][0]).toMatchObject({expectedDraftRevision:1,idempotencyKey:'key-2',content:{reason:'corrected'}});
  await session.drain(); expect(save).toHaveBeenCalledTimes(2); expect(session.hasUnacknowledged).toBe(false); session.dispose();
});
it('503 retains original key and payload before saving corrected content', async () => {
  const save = vi.fn().mockRejectedValueOnce(new CorrectionClientError(503,'STORAGE_UNAVAILABLE')).mockImplementation(async cmd => dto(cmd.content, cmd.expectedDraftRevision + 1));
  let key=0; const session = new CorrectionSession(editor,dto({edits:[],reason:'old',evidenceNote:''}),{save} as never,()=>`key-${++key}`);
  session.change({...session.snapshot.content,reason:'uncertain'});await expect(session.drain()).rejects.toThrow();
  session.change({...session.snapshot.content,reason:'corrected'});await expect(session.drain()).rejects.toThrow('SAVE_RETRY_REQUIRED');
  await session.retry();expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);expect(save.mock.calls[2][0]).toMatchObject({expectedDraftRevision:2,idempotencyKey:'key-2',content:{reason:'corrected'}});session.dispose();
});

it('reload restores matching stored comparison and ignores a disposed late read after changed inputs', async () => {
  const saved = {...dto({edits:[],reason:'saved',evidenceNote:''}),currentPreviewId:'p'};
  const detail = vi.fn(async()=>comparisonDetail());
  const session = new CorrectionSession(editor,saved,{detail} as never);
  await session.loadSavedPreview();expect(session.canConfirm).toBe(true);expect(session.snapshot.comparison).toEqual(comparisonDetail().preview);
  session.dispose();
  const late = defer<ReturnType<typeof comparisonDetail>>();
  const other = new CorrectionSession(editor,saved,{detail:()=>late.promise} as never);
  const loading=other.loadSavedPreview();other.dispose();
  other.change({...other.snapshot.content,reason:'new local reason'});
  late.resolve(comparisonDetail());await loading;
  expect(other.snapshot.content.reason).toBe('new local reason');expect(other.canConfirm).toBe(false);expect(other.snapshot.preview).toBeNull();other.dispose();
});
it('failed saved read can reload same comparison without issuing preview or mutation', async () => {
  const detail=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(comparisonDetail());
  const preview=vi.fn(),save=vi.fn();const session=new CorrectionSession(editor,{...dto({edits:[],reason:'saved',evidenceNote:''}),currentPreviewId:'p'},{detail,preview,save} as never);
  await session.loadSavedPreview();expect(session.canConfirm).toBe(false);
  await session.loadSavedPreview();expect(session.canConfirm).toBe(true);expect(preview).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();session.dispose();
});
it.each(['closed','confirmed','reflected','stale'])('reloaded %s work remains read only and cannot publish a confirmation', async state => {
  const detail={...comparisonDetail(),summary:{...comparisonDetail().summary,state,capabilities:{resume:false}}};
  const session=new CorrectionSession(editor,{...dto({edits:[],reason:'saved',evidenceNote:''}),currentPreviewId:'p'},{detail:async()=>detail} as never);
  await session.loadSavedPreview();expect(session.canConfirm).toBe(false);expect(session.snapshot.preview).toBeNull();session.dispose();
});
it.each([{allowedActions: []}, {allowedActions: ['set-missing']}])('session rejects forbidden numeric edit before queueing a write for allowed actions $allowedActions', async ({allowedActions}) => {
  const create=vi.fn(),save=vi.fn();const row={rowId:'locked',category:'economic',label:'조회 실패',sourceRound:'2026/01',period:'2025/12',unit:'지수',originalText:'',originalState:'missing',allowedActions};
  const session=new CorrectionSession({...editor,rows:[row]} as unknown as CorrectionEditorDto,null,{create,save} as never);
  session.change({edits:[{rowId:'locked',action:'set',rawValue:'10'}],reason:'attempt',evidenceNote:''});
  await session.drain();expect(session.snapshot.content.edits).toEqual([]);expect(session.snapshot.errors[0]).toMatchObject({rowId:'locked',field:'action',code:'INVALID_ACTION'});
  expect(create).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();expect(session.canConfirm).toBe(false);session.dispose();
});
it.each([422,413])('definite create %s rejection allows corrected content with one new command and no duplicate draft', async status=>{
  const create=vi.fn().mockRejectedValueOnce(new CorrectionClientError(status,'INVALID_DRAFT')).mockImplementation(async cmd=>dto(cmd.content));
  const save=vi.fn();let key=0;const session=new CorrectionSession(editor,null,{create,save} as never,()=>`create-${++key}`);
  session.change({edits:[],reason:'rejected',evidenceNote:''});await expect(session.drain()).rejects.toThrow();
  session.change({edits:[],reason:'corrected',evidenceNote:''});await session.drain();await session.drain();
  expect(create).toHaveBeenCalledTimes(2);expect(create.mock.calls[1][0]).toMatchObject({idempotencyKey:'create-2',content:{reason:'corrected'}});expect(save).not.toHaveBeenCalled();expect(session.snapshot.draft?.draftId).toBe('same');session.dispose();
});
