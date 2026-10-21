import { describe, expect, it } from 'vitest';
import { createStatement } from '@/domain/cashflow/statement';
import { amount } from '@/domain/shared/amount';
import { arrangeRounds } from './uploaded-rounds';
import { INITIAL_UPLOAD_SESSION, uploadSessionReducer as reduce, type ReadyRounds, type UploadSession } from './upload-session';

function file(name: string): File {
  return new File(['synthetic'], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', lastModified: 1 });
}

function rounds(month: number, name: string): ReadyRounds {
  const values = Array.from({ length: 12 }, () => amount(100));
  const statement = createStatement({
    asOf: new Date(2026, month - 1, 10),
    monthLabels: Array.from({ length: 12 }, (_, index) => `${index + 1}월`),
    baseMonthIndex: month - 1,
    planYearEndIndex: 11,
    amounts: { 기초시재: values, 수입계: values, 수입: values, 분양회수: values, 기타수입: values, 지출: values },
  });
  const arranged = arrangeRounds([{ file: name, statement }]);
  if (!arranged.ok) throw new Error(arranged.reason);
  return arranged;
}

function committed(): UploadSession {
  const files = [file('synthetic-august.xlsx')];
  const previous = rounds(8, files[0].name);
  return { files, prepared: { kind: 'ready', rounds: previous }, committed: { files, rounds: previous }, operationId: 1 };
}

describe('파일 준비와 확정 결과의 분리', () => {
  it('확정 뒤 새 파일 읽기에 실패해도 이전 원본을 유지하고 파일 선택까지 복원한다', () => {
    const original = committed();
    let state = reduce(original, { type: 'select', id: 2, files: [file('broken.xlsx')] });
    state = reduce(state, { type: 'fail', id: 2, reason: '시트를 찾을 수 없습니다.' });
    expect(state.prepared).toEqual({ kind: 'error', reason: '시트를 찾을 수 없습니다.' });
    expect(state.committed).toBe(original.committed);
    expect(state.committed?.rounds.latest.round).toBe('2026/08');

    state = reduce(state, { type: 'restore', id: 3 });
    expect(state.files).toBe(original.files);
    expect(state.prepared).toEqual({ kind: 'ready', rounds: original.committed!.rounds });
    expect(state.committed).toBe(original.committed);
    expect(state.operationId).toBe(3);
  });

  it('A를 읽는 중 B를 고르면 늦게 온 A의 진행·완료·실패를 반영하지 않는다', () => {
    let state = reduce(INITIAL_UPLOAD_SESSION, { type: 'select', id: 1, files: [file('a.xlsx')] });
    const bFiles = [file('b.xlsx')];
    state = reduce(state, { type: 'select', id: 2, files: bFiles });
    const selectedB = state;
    state = reduce(state, { type: 'progress', id: 1, done: 1 });
    state = reduce(state, { type: 'ready', id: 1, rounds: rounds(7, 'a.xlsx') });
    state = reduce(state, { type: 'fail', id: 1, reason: '늦게 도착한 오류' });
    expect(state).toBe(selectedB);
    expect(state.files).toBe(bFiles);
    expect(state.prepared).toEqual({ kind: 'reading', done: 0, total: 1 });
    const b = rounds(8, 'b.xlsx');
    state = reduce(state, { type: 'ready', id: 2, rounds: b });
    expect(state.prepared).toEqual({ kind: 'ready', rounds: b });
    expect(state.committed).toBeNull();
  });

  it('읽는 중 선택을 비워도 확정 결과를 유지하고 취소된 읽기 응답을 무시한다', () => {
    const original = committed();
    let state = reduce(original, { type: 'select', id: 2, files: [file('new.xlsx')] });
    state = reduce(state, { type: 'select', id: 3, files: [] });
    const cleared = state;
    state = reduce(state, { type: 'ready', id: 2, rounds: rounds(9, 'new.xlsx') });
    state = reduce(state, { type: 'fail', id: 2, reason: '취소 뒤 오류' });
    expect(state).toBe(cleared);
    expect(state.files).toEqual([]);
    expect(state.prepared).toEqual({ kind: 'empty' });
    expect(state.committed).toBe(original.committed);
  });

  it('읽는 중 이전 결과로 복원하면 늦은 응답이 복원을 덮어쓰지 못한다', () => {
    const original = committed();
    let state = reduce(original, { type: 'select', id: 2, files: [file('new.xlsx')] });
    state = reduce(state, { type: 'restore', id: 3 });
    const restored = state;
    expect(state.operationId).toBe(3);
    state = reduce(state, { type: 'progress', id: 2, done: 1 });
    state = reduce(state, { type: 'ready', id: 2, rounds: rounds(9, 'new.xlsx') });
    expect(state).toBe(restored);
    expect(state.files).toBe(original.files);
    expect(state.prepared).toEqual({ kind: 'ready', rounds: original.committed!.rounds });
    expect(state.committed).toBe(original.committed);
  });

  it('새 회차 준비 완료만으로 결과 출처를 바꾸지 않고 산출 적용 때 교체한다', () => {
    const original = committed();
    const newFiles = [file('synthetic-september.xlsx')];
    const next = rounds(9, newFiles[0].name);
    let state = reduce(original, { type: 'select', id: 2, files: newFiles });
    state = reduce(state, { type: 'progress', id: 2, done: 1 });
    expect(state.prepared).toEqual({ kind: 'reading', done: 1, total: 1 });
    state = reduce(state, { type: 'ready', id: 2, rounds: next });
    expect(state.committed).toBe(original.committed);
    state = reduce(state, { type: 'apply' });
    expect(state.committed?.files).toBe(newFiles);
    expect(state.committed?.rounds).toBe(next);
    expect(state.committed?.rounds.latest.round).toBe('2026/09');
  });

  it('같은 File 객체나 이름·크기가 같은 파일도 다시 고를 때마다 읽기를 시작한다', () => {
    const original = committed();
    let state = reduce(original, { type: 'select', id: 2, files: original.files });
    expect(state.prepared).toEqual({ kind: 'reading', done: 0, total: 1 });
    expect(state.committed).toBe(original.committed);
    state = reduce(state, { type: 'ready', id: 2, rounds: rounds(8, original.files[0].name) });
    const sameMetadata = [file(original.files[0].name)];
    expect(sameMetadata[0].size).toBe(original.files[0].size);
    state = reduce(state, { type: 'select', id: 3, files: sameMetadata });
    expect(state.files).toBe(sameMetadata);
    expect(state.prepared).toEqual({ kind: 'reading', done: 0, total: 1 });
  });

  it('현재 읽기가 끝난 뒤 같은 작업의 늦은 오류가 준비 완료를 덮어쓰지 못한다', () => {
    let state = reduce(INITIAL_UPLOAD_SESSION, { type: 'select', id: 1, files: [file('a.xlsx')] });
    const completed = rounds(8, 'a.xlsx');
    state = reduce(state, { type: 'ready', id: 1, rounds: completed });
    expect(state.prepared).toEqual({ kind: 'ready', rounds: completed });
    const ready = state;
    expect(reduce(state, { type: 'fail', id: 1, reason: '늦은 오류' })).toBe(ready);
  });

  it('읽기·오류·빈 선택 상태에서는 산출 적용으로 확정 결과를 바꾸지 않는다', () => {
    const original = committed();
    let state = reduce(original, { type: 'select', id: 2, files: [file('a.xlsx')] });
    expect(state.prepared.kind).toBe('reading');
    expect(reduce(state, { type: 'apply' })).toBe(state);
    state = reduce(state, { type: 'fail', id: 2, reason: '오류' });
    expect(reduce(state, { type: 'apply' })).toBe(state);
    state = reduce(state, { type: 'select', id: 3, files: [] });
    expect(reduce(state, { type: 'apply' })).toBe(state);
    expect(state.committed).toBe(original.committed);
  });
});
