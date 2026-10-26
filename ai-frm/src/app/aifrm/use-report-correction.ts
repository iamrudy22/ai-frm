'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { CorrectionDraftDto, CorrectionEditorDto, CorrectionEditResult, CorrectionFieldError, CorrectionMonthSummary, CorrectionReviewDetail, CorrectionWorkRef, CorrectionWorkSummary, DraftContent, SaveDraftCommand } from '@/domain/report-history/correction';
import type { CorrectionConfirmCommand } from '@/application/report-history/ports';
export class CorrectionClientError extends Error {
  constructor(readonly status: number, readonly code: string, readonly errors: readonly CorrectionFieldError[] = []) { super(code); }
}
export function correctionErrorMessage(error: unknown) {
  if(error instanceof CorrectionClientError&&error.code==='CONFLICT_CHANGED_DURING_READ')
    return '조회 중 다른 변경이 저장되었습니다. 내 입력을 유지했으니 최신 내용을 다시 조회해 비교해 주세요.';
  if (error instanceof CorrectionClientError && error.status === 409)
    return '다른 변경이 먼저 저장되었습니다. 입력을 유지했으니 최신 내용과 다시 비교해 주세요.';
  if (error instanceof CorrectionClientError && error.status === 413)
    return '입력 분량이 너무 큽니다. 수정 항목이나 입력을 줄인 뒤 다시 저장해 주세요.';
  return error instanceof CorrectionClientError && error.status === 422 ? '입력과 사유를 확인해 주세요.' : '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.';
}
type Page<T> = {
  items: readonly T[];
  nextCursor: string | null;
};
type MonthsQuery = {
  pendingOnly: boolean;
  fromCycle?: string;
  toCycle?: string;
  cursor?: string;
};
type WorkQuery = {
  pendingOnly: boolean;
  reportCycle?: string;
  cursor?: string;
};
export function createCorrectionClient(request: typeof fetch = fetch) {
  async function json(url: string, body?: unknown) {
    const response = await request(url, { cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok || !data.ok)
      throw new CorrectionClientError(response.status, data.code ?? data.result?.reason ?? 'STORAGE_UNAVAILABLE', data.errors ?? []);
    return data;
  }
  const query = (path: string, values: Record<string, string | number | boolean | undefined>) => `${path}?${new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`;
  return {
    open: async (confirmationId: string): Promise<CorrectionEditorDto> => (await json('/api/report-history/editor', { action: 'open', confirmationId })).editor,
    resume: async (draftId: string): Promise<CorrectionDraftDto> => (await json(query('/api/report-history/drafts', { draftId }))).draft,
    create: async (cmd: {
      basisId: string;
      idempotencyKey: string;
      content: DraftContent;
    }): Promise<CorrectionDraftDto | null> => { const body = await json('/api/report-history/drafts', { action: 'create', ...cmd }); return body.draft ?? null; },
    save: async (cmd: SaveDraftCommand): Promise<CorrectionDraftDto> => (await json('/api/report-history/drafts', { action: 'save', ...cmd })).draft,
    preview: async (draftId: string, expectedDraftRevision: number): Promise<CorrectionEditResult> => (await json('/api/report-history/editor', { action: 'preview', draftId, expectedDraftRevision })).result,
    confirm: async (cmd: CorrectionConfirmCommand): Promise<{
      kind: string;
      confirmationId: string;
      revision: number;
    }> => (await json('/api/report-history/corrections', cmd)).result,
    months: async (values: MonthsQuery): Promise<Page<CorrectionMonthSummary>> => json(query('/api/report-history/reviews', { view: 'months', ...values, limit: 12 })),
    work: async (values: WorkQuery): Promise<Page<CorrectionWorkSummary>> => json(query('/api/report-history/reviews', { ...values, limit: 20 })),
    detail: async (ref: CorrectionWorkRef): Promise<CorrectionReviewDetail> => (await json(query('/api/report-history/reviews', { refKind: ref.kind, refId: ref.id }))).detail,
    close: async (ref: CorrectionWorkRef, expectedDraftRevision: number | null, idempotencyKey: string): Promise<CorrectionWorkSummary> => (await json('/api/report-history/reviews', { action: 'close', ref, expectedDraftRevision, idempotencyKey })).result,
    copy: async (ref: CorrectionWorkRef, idempotencyKey: string): Promise<CorrectionDraftDto | {
      kind: 'no-change';
    }> => (await json('/api/report-history/reviews', { action: 'copy', ref, idempotencyKey })).result,
    reapply: async (cmd: {
      draftId: string;
      expectedDraftRevision: number;
      expectedLatestConfirmationId: string;
      idempotencyKey: string;
    }): Promise<CorrectionDraftDto | {
      kind: 'no-change';
    }> => (await json('/api/report-history/reviews', { action: 'reapply', ...cmd })).result,
  };
}
export type CorrectionClient = ReturnType<typeof createCorrectionClient>;
type Preview = Extract<CorrectionEditResult, {
  kind: 'preview';
}>;
export type CorrectionSessionState = {
  editor: CorrectionEditorDto;
  draft: CorrectionDraftDto | null;
  content: DraftContent;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
  conflict: {
    code: string;
    latest: {
      draft: CorrectionDraftDto | null;
      detail: CorrectionReviewDetail | null;
      editor: CorrectionEditorDto;
    } | null;
  } | null;
  preview: Preview | null;
  comparison: CorrectionReviewDetail['preview'];
  errors: readonly CorrectionFieldError[];
  message: string;
  busy: boolean;
  completed: boolean;
  stale: boolean;
};
type Pending = {
  version: number;
  content: DraftContent;
  idempotencyKey: string;
  draftId?: string;
  expectedDraftRevision?: number;
};
/** One session owns one write queue. ACKs never replace the editor's latest raw text. */
export class CorrectionSession {
  private value: CorrectionSessionState;
  private listeners = new Set<() => void>();
  private version = 0;
  private ackVersion = 0;
  private pending: Pending | null = null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private command: CorrectionConfirmCommand | null = null;
  private saveDeadline = 0;
  private comparisonGeneration = 0;
  constructor(editor: CorrectionEditorDto, draft: CorrectionDraftDto | null, private client: CorrectionClient, private nextKey: () => string = () => crypto.randomUUID()) {
    this.value = { editor, draft, content: draft?.content ?? { edits: [], reason: '', evidenceNote: '' }, saveStatus: draft ? 'saved' : 'idle', conflict: null, preview: null, comparison: null, errors: [], message: '', busy: false, completed: false, stale: false };
  }
  get snapshot() { return this.value; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.value;
  private emit(patch: Partial<CorrectionSessionState>) {
    if (patch.preview === null) patch = { ...patch, comparison: null };
    this.value = { ...this.value, ...patch };
    this.listeners.forEach(listener => listener());
  }
  get hasUnacknowledged() { return this.version !== this.ackVersion || this.pending !== null; }
  get canConfirm() {
    const { preview, comparison, draft } = this.value;
    return !!preview && !!comparison && comparison.previewId === preview.previewId
      && comparison.previewHash === preview.previewHash && comparison.draftRevision === preview.draftRevision
      && !this.hasUnacknowledged && !this.value.busy && !this.value.completed && this.value.errors.length === 0
      && !this.value.stale && !draft?.requiresReapply && !this.value.conflict && this.value.saveStatus !== 'error'
      && preview.draftRevision === draft?.draftRevision;
  }
  change(content: DraftContent) {
    if (this.value.busy || this.value.completed || this.value.draft?.requiresReapply)
      return;
    const forbiddenEdit = content.edits.find(edit => {
      const row = this.value.editor.rows.find(row => row.rowId === edit.rowId);
      return row && !row.allowedActions.includes(edit.action);
    });
    if (forbiddenEdit) {
      this.command = null;
      this.emit({ preview: null, errors: [{ rowId: forbiddenEdit.rowId, field: 'action', code: 'INVALID_ACTION', message: '이 항목에서 허용하지 않는 수정입니다.' }] });
      return;
    }
    const longEdit = content.edits.find(edit => (edit.rawValue?.length ?? 0) > 2000);
    if (content.reason.length > 2000 || content.evidenceNote.length > 2000 || longEdit) {
      this.command = null;
      this.emit({ preview: null, errors: [{ rowId: longEdit?.rowId ?? null, field: longEdit ? 'value' : content.reason.length > 2000 ? 'reason' : 'evidenceNote', code: 'LIMIT_EXCEEDED', message: '2000자 이내로 입력해 주세요.' }] });
      return;
    }
    this.version++;
    this.command = null;
    this.emit({ content, preview: null, errors: [], message: '', saveStatus: this.value.conflict ? 'conflict' : this.value.saveStatus === 'error' && this.pending ? 'error' : 'saving' });
    if (this.timer)
      clearTimeout(this.timer);
    this.saveDeadline = Date.now() + 1000;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.value.saveStatus !== 'error' && !this.value.conflict)
        void this.flush(false).catch(() => { });
    }, 1000);
  }
  private async pump(force: boolean): Promise<void> {
    while (this.hasUnacknowledged) {
      if (!this.pending && !force && Date.now() < this.saveDeadline)
        return;
      if (!this.pending)
        this.pending = { version: this.version, content: this.value.content, idempotencyKey: this.nextKey(), ...(this.value.draft ? { draftId: this.value.draft.draftId, expectedDraftRevision: this.value.draft.draftRevision } : {}) };
      const sent = this.pending;
      this.emit({ saveStatus: 'saving' });
      try {
        const ack = sent.draftId ? await this.client.save({ draftId: sent.draftId, expectedDraftRevision: sent.expectedDraftRevision!, idempotencyKey: sent.idempotencyKey, content: sent.content }) : await this.client.create({ basisId: this.value.editor.basisId, idempotencyKey: sent.idempotencyKey, content: sent.content });
        this.ackVersion = sent.version;
        this.pending = null;
        this.emit({ draft: ack ?? this.value.draft, saveStatus: this.version === this.ackVersion ? 'saved' : 'saving' });
      }
      catch (error) {
        if (error instanceof CorrectionClientError && error.status === 409) {
          this.pending = null;
          this.command = null;
          this.emit({ saveStatus: 'conflict', conflict: { code: error.code, latest: null }, preview: null, message: '다른 변경과 충돌했습니다. 내 입력을 유지한 채 최신 내용을 조회하고 복구 방법을 선택해 주세요.' });
        }
        else {
          if (error instanceof CorrectionClientError && [422, 413].includes(error.status)) this.pending = null;
          this.emit({ saveStatus: 'error', errors: error instanceof CorrectionClientError ? error.errors : [], message: correctionErrorMessage(error) });
        }
        throw error;
      }
    }
  }
  async drain(): Promise<void> { return this.flush(true); }
  private async flush(force: boolean): Promise<void> {
    if (force && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) {
      await this.running;
      return this.flush(force);
    }
    if (this.value.conflict)
      throw Error('CONFLICT_REVIEW_REQUIRED');
    if (this.value.saveStatus === 'error')
      throw Error('SAVE_RETRY_REQUIRED');
    if (!this.hasUnacknowledged)
      return;
    const run = this.pump(force);
    this.running = run;
    try {
      await run;
    }
    finally {
      if (this.running === run)
        this.running = null;
    }
  }
  async retry() {
    if (this.value.conflict)
      throw Error('CONFLICT_REVIEW_REQUIRED');
    if (this.running)
      return this.running;
    this.emit({ saveStatus: 'saving', message: '' });
    return this.drain();
  }
  async readConflictLatest(): Promise<void> {
    if (!this.value.conflict || this.value.busy)
      return;
    this.emit({ busy: true, conflict: { ...this.value.conflict, latest: null } });
    try {
      if (this.value.draft) {
        const draft = await this.client.resume(this.value.draft.draftId);
        const detail = await this.client.detail({ kind: 'draft', id: draft.draftId });
        const verified=await this.client.resume(draft.draftId);
        if(verified.draftId!==draft.draftId||verified.draftRevision!==draft.draftRevision||verified.editor.basisId!==draft.editor.basisId)
          throw new CorrectionClientError(409,'CONFLICT_CHANGED_DURING_READ');
        this.emit({ conflict: { ...this.value.conflict!, latest: { draft, detail, editor: draft.editor } }, message: '내 입력과 서버에 보관된 최신 내용을 확인해 주세요.' });
      }
      else {
        const cycle = this.value.editor.basis.reportCycle;
        const page = await this.client.months({ pendingOnly: false, fromCycle: cycle, toCycle: cycle });
        const month = page.items.find(item => item.reportCycle === cycle);
        if (!month)
          throw Error('NOT_FOUND');
        const editor = await this.client.open(month.latestConfirmationId);
        this.emit({ conflict: { ...this.value.conflict!, latest: { draft: null, detail: null, editor } }, message: '내 입력과 최신 확정본 원자료를 확인해 주세요.' });
      }
    }
    catch (error) {
      this.emit({ message: correctionErrorMessage(error) });
      throw error;
    }
    finally {
      this.emit({ busy: false });
    }
  }
  /** Call only after showing the comparison and the user's explicit discard choice. No write. */
  acceptConflictLatest(): void {
    const latest = this.value.conflict?.latest;
    if (!latest || this.value.busy)
      throw Error('CONFLICT_COMPARISON_REQUIRED');
    if (this.timer)
      clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.command = null;
    this.ackVersion = this.version;
    const readonly = !!latest.detail && !latest.detail.summary.capabilities.resume;
    this.emit({ editor: latest.editor, draft: latest.draft, content: latest.draft?.content ?? { edits: [], reason: '', evidenceNote: '' }, saveStatus: latest.draft ? 'saved' : 'idle', conflict: null, preview: null, comparison: null, errors: [], completed: readonly, stale: latest.detail?.summary.state === 'stale', message: readonly ? '처리된 수정안입니다. 읽기 전용으로 확인합니다.' : latest.detail?.summary.state==='stale'?'기준 확정본이 바뀌었습니다. 목록에서 검토 종료한 뒤 새 수정안으로 다시 검토해 주세요.':'서버의 최신 내용으로 전환했습니다.' });
  }
  markStale() { this.command = null; this.emit({ stale: true, preview: null, message: '기준 확정본이 바뀌었습니다. 목록에서 이 안을 검토 종료한 뒤 새 수정안으로 다시 검토해 주세요.' }); }
  private async readComparison(draft: CorrectionDraftDto, expected: { previewId: string; previewHash?: string; draftRevision: number }, version: number, generation: number) {
    const detail = await this.client.detail({ kind: 'draft', id: draft.draftId });
    if (generation !== this.comparisonGeneration || version !== this.version || this.hasUnacknowledged
      || this.value.stale || this.value.completed || this.value.draft?.draftId !== draft.draftId
      || this.value.draft.draftRevision !== draft.draftRevision) return;
    const comparison = detail.preview;
    if (!comparison || !Array.isArray(comparison.rawDiff) || !Array.isArray(comparison.resultDiff) || !Array.isArray(comparison.affectedReports)
      || detail.summary.ref.kind !== 'draft' || detail.summary.ref.id !== draft.draftId
      || detail.summary.state !== 'pending' || !detail.summary.capabilities.resume
      || comparison.previewId !== expected.previewId
      || (expected.previewHash !== undefined && comparison.previewHash !== expected.previewHash)
      || comparison.draftRevision !== expected.draftRevision || comparison.baseRevision !== this.value.editor.baseRevision
      || detail.summary.baseRevision !== this.value.editor.baseRevision)
      throw new CorrectionClientError(409, 'PREVIEW_COMPARISON_MISMATCH');
    this.emit({ preview: { kind: 'preview', previewId: comparison.previewId, previewHash: comparison.previewHash, draftRevision: expected.draftRevision }, comparison, message: '확정 대기 · 저장된 산출값과 영향을 확인해 주세요.' });
  }
  async loadSavedPreview() {
    const draft = this.value.draft;
    if (!draft?.currentPreviewId || draft.requiresReapply || this.value.completed || this.value.stale || this.value.busy || this.hasUnacknowledged) return;
    const generation = ++this.comparisonGeneration;
    this.emit({ busy: true, preview: null, message: '저장된 변경 비교 조회 중' });
    try { await this.readComparison(draft, { previewId: draft.currentPreviewId, draftRevision: draft.draftRevision }, this.version, generation); }
    catch (error) { if (generation === this.comparisonGeneration) this.emit({ message: correctionErrorMessage(error) }); }
    finally { if (generation === this.comparisonGeneration) this.emit({ busy: false }); }
  }
  async preview() {
    await this.drain();
    const draft = this.value.draft;
    if (!draft || draft.requiresReapply || this.value.completed || this.value.stale)
      return;
    const version = this.version;
    const generation = ++this.comparisonGeneration;
    this.command = null;
    this.emit({ busy: true, preview: null, errors: [], message: '' });
    try {
      const result = await this.client.preview(draft.draftId, draft.draftRevision);
      if (version !== this.version || generation !== this.comparisonGeneration)
        return;
      if (result.kind === 'preview' && result.draftRevision === draft.draftRevision)
        await this.readComparison(draft, result, version, generation);
      else
        this.emit({ errors: result.kind === 'invalid' ? result.errors : [], message: result.kind === 'no-change' ? '변경 없음 · 새 확정 차수를 만들지 않습니다.' : '입력을 확인해 주세요.' });
    }
    catch (error) {
      if (generation === this.comparisonGeneration) this.emit({ errors: error instanceof CorrectionClientError ? error.errors : [], message: correctionErrorMessage(error) });
    }
    finally {
      if (generation === this.comparisonGeneration) this.emit({ busy: false });
    }
  }
  async confirm() {
    if (!this.canConfirm)
      return null;
    const preview = this.value.preview!;
    const command = this.command ?? { previewId: preview.previewId, previewHash: preview.previewHash, expectedBaseRevision: this.value.editor.baseRevision, idempotencyKey: this.nextKey(), reason: this.value.content.reason.trim() };
    this.command = command;
    this.emit({ busy: true, message: '정정 확정 중' });
    try {
      const result = await this.client.confirm(command);
      if (result.kind !== 'confirmed' && result.kind !== 'already-confirmed')
        throw Error('UNKNOWN_CONFIRMATION');
      this.command = null;
      this.emit({ completed: true, message: `정정 확정됨 · ${result.revision}차` });
      return result;
    }
    catch (error) {
      if (error instanceof CorrectionClientError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
        this.command = null;
        this.emit({ preview: null });
      }
      this.emit({ message: correctionErrorMessage(error) });
      throw error;
    }
    finally {
      this.emit({ busy: false });
    }
  }
  dispose() {
    this.comparisonGeneration++;
    this.emit({ busy: false });
    if (this.timer)
      clearTimeout(this.timer);
    this.timer = null;
  }
}
export function useReportCorrection(session: CorrectionSession) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    void session.loadSavedPreview();
    const listener = (event: BeforeUnloadEvent) => {
      if (session.hasUnacknowledged) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', listener);
    return () => { window.removeEventListener('beforeunload', listener); session.dispose(); };
  }, [session]);
  return state;
}
