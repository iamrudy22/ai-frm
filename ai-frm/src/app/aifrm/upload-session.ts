import type { ArrangedRounds } from './uploaded-rounds';

export type ReadyRounds = Extract<ArrangedRounds, { ok: true }>;

export type PreparedUpload =
  | { readonly kind: 'empty' }
  | { readonly kind: 'reading'; readonly done: number; readonly total: number }
  | { readonly kind: 'error'; readonly reason: string }
  | { readonly kind: 'ready'; readonly rounds: ReadyRounds };

export type UploadSession = {
  readonly files: File[];
  readonly prepared: PreparedUpload;
  readonly committed: { readonly files: File[]; readonly rounds: ReadyRounds } | null;
  readonly operationId: number;
};

export type UploadAction =
  | { readonly type: 'select'; readonly id: number; readonly files: File[] }
  | { readonly type: 'progress'; readonly id: number; readonly done: number }
  | { readonly type: 'ready'; readonly id: number; readonly rounds: ReadyRounds }
  | { readonly type: 'fail'; readonly id: number; readonly reason: string }
  | { readonly type: 'apply' }
  | { readonly type: 'restore'; readonly id: number };

export const INITIAL_UPLOAD_SESSION: UploadSession = {
  files: [], prepared: { kind: 'empty' }, committed: null, operationId: 0,
};

/** 입력 준비 상태만 다룬다. 읽기·회차 정리·지표 계산은 호출하는 페이지가 맡는다. */
export function uploadSessionReducer(state: UploadSession, action: UploadAction): UploadSession {
  if (action.type === 'select') {
    if (action.id <= state.operationId) return state;
    return {
      ...state,
      files: action.files,
      operationId: action.id,
      prepared: action.files.length === 0 ? { kind: 'empty' }
        : { kind: 'reading', done: 0, total: action.files.length },
    };
  }
  if (action.type === 'restore') {
    if (action.id <= state.operationId) return state;
    return {
      ...state,
      operationId: action.id,
      files: state.committed?.files ?? [],
      prepared: state.committed === null ? { kind: 'empty' }
        : { kind: 'ready', rounds: state.committed.rounds },
    };
  }
  if (action.type === 'apply') {
    if (state.prepared.kind !== 'ready' || state.committed?.rounds === state.prepared.rounds) return state;
    return { ...state, committed: { files: state.files, rounds: state.prepared.rounds } };
  }

  // 완료·취소된 읽기와 이전 선택에서 늦게 온 응답은 현재 준비 상태를 바꾸지 않는다.
  if (action.id !== state.operationId || state.prepared.kind !== 'reading') return state;
  switch (action.type) {
    case 'progress':
      return { ...state, prepared: { ...state.prepared, done: action.done } };
    case 'ready':
      return { ...state, prepared: { kind: 'ready', rounds: action.rounds } };
    case 'fail':
      return { ...state, prepared: { kind: 'error', reason: action.reason } };
  }
}
