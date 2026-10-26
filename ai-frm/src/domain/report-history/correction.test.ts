import { describe, expect, it } from 'vitest';
import { parseYearMonth } from '../shared/year-month';
import {
  correctionWorkState, correctionPatchAlreadyApplied, isEmptyDraftContent,
  normalizeCorrectionEdits, normalizeCorrectionRowEdit, parseCorrectionDecimal, toCorrectionEditorDto, validateDraftContent,
  type CorrectionBasis, type CorrectionBasisRow, type DraftContent,
} from './correction';

const row = (overrides: Partial<CorrectionBasisRow> = {}): CorrectionBasisRow => ({
  rowId: 'row-1', category: 'economic', label: '경제 원자료', sourceRound: '2026/08', period: '2026/06', unit: '지수',
  sourceRecordId: 'capture-1', fieldPath: 'series.test.2026/06', originalValue: 1.0000000000000002,
  originalText: '1.0000000000000002', originalState: 'available', allowedActions: ['set', 'set-missing'],
  sourceIdentity: { kind: 'ecos', indicator: 'test', statistic: 'STAT', items: ['ITEM'] }, ...overrides,
});
const basis = (rows: readonly CorrectionBasisRow[] = [row()]): CorrectionBasis => ({
  recordKind: 'correction-basis', payloadVersion: 2, basisId: 'basis-1', scopeId: 'scope-1',
  baseConfirmationId: 'confirmation-1', baseRevision: 1, baseDocumentHash: 'document-hash',
  basis: { reportCycle: parseYearMonth('2026/08'), reportTitleMonth: parseYearMonth('2026/07'), constructionBaseMonth: parseYearMonth('2026/06'), fundingJudgedMonth: parseYearMonth('2026/08'), fundingObservedMonth: parseYearMonth('2026/07'), gapMonth: parseYearMonth('2026/08') },
  inputSnapshotId: 'input-1', inputHash: 'input-hash', calculationIds: { construction: 'construction-1', funding: 'funding-1' },
  historySelectionId: 'selection-1', calculationVersion: 'v1', templateVersion: 't1', createdAt: '2026-10-26T00:00:00.000Z', rows,
});
const request = (rawValue: string | null, action: 'set' | 'set-missing' = 'set') => ({ basisId: 'basis-1', reason: ' 정정 사유 ', edits: [{ rowId: 'row-1', action, rawValue, evidenceNote: '근거' }] });
const content = (rawValue = '-'): DraftContent => ({ edits: [{ rowId: 'row-1', action: 'set', rawValue }], reason: '', evidenceNote: '' });

describe('웹 정정 원자료 경계', () => {
  it('decimal_zero_negative_precision_and_missing_are_distinct', () => {
    for (const [raw, value] of [['0', 0], ['-0.5', -0.5], ['1.0000000000000004', 1.0000000000000004]] as const) {
      expect(normalizeCorrectionEdits(basis(), request(raw))).toMatchObject({ kind: 'valid', patch: [{ value }], reason: '정정 사유' });
    }
    expect(normalizeCorrectionEdits(basis(), request(null, 'set-missing'))).toMatchObject({ kind: 'valid', patch: [{ value: null, action: 'set-missing' }] });
    expect(normalizeCorrectionEdits(basis(), request(''))).toEqual({ kind: 'no-change' });
    expect(basis().rows[0].originalValue).toBe(1.0000000000000002);
  });
  it.each(['1e3', '1,000', ' 1', '1%', 'NaN', 'Infinity', '9'.repeat(400), `0.${'0'.repeat(400)}1`])('십진 문법과 overflow/underflow를 거부한다: %s', raw => {
    expect(normalizeCorrectionEdits(basis(), request(raw))).toMatchObject({ kind: 'invalid', errors: [{ rowId: 'row-1', field: 'value', code: 'INVALID_NUMBER' }] });
  });
  it('unknown_duplicate_protected_row_is_rejected', () => {
    expect(normalizeCorrectionEdits(basis(), { ...request('2'), basisId: 'other' })).toMatchObject({ kind: 'invalid' });
    expect(normalizeCorrectionEdits(basis(), { ...request('2'), edits: [{ ...request('2').edits[0], rowId: 'unknown' }] })).toMatchObject({ kind: 'invalid' });
    expect(normalizeCorrectionEdits(basis(), { ...request('2'), edits: [...request('2').edits, ...request('2').edits] })).toMatchObject({ kind: 'invalid' });
    expect(normalizeCorrectionEdits(basis([row({ allowedActions: [] })]), request('2'))).toMatchObject({ kind: 'invalid' });
    expect(normalizeCorrectionEdits(basis(), { ...request('2'), edits: [{ ...request('2').edits[0], unit: '억원' }] } as never)).toMatchObject({ kind: 'invalid' });
    expect(normalizeCorrectionEdits(basis(), request('2', 'set-missing'))).toMatchObject({ kind: 'invalid' });
    expect(normalizeCorrectionEdits(basis(), request(null))).toMatchObject({ kind: 'invalid' });
  });
  it('unchanged_patch_is_noop', () => {
    expect(normalizeCorrectionEdits(basis(), request('1.0000000000000002'))).toEqual({ kind: 'no-change' });
    expect(normalizeCorrectionEdits(basis([row({ originalValue: 0, originalText: '0' })]), request('-0'))).toEqual({ kind: 'no-change' });
    expect(normalizeCorrectionEdits(basis([row({ originalValue: null, originalText: '', originalState: 'missing' })]), request(null, 'set-missing'))).toEqual({ kind: 'no-change' });
    expect(normalizeCorrectionEdits(basis(), { ...request('2'), reason: ' \n ' })).toMatchObject({ kind: 'invalid', errors: [{ field: 'reason' }] });
  });
  it('사유와 메모는 원문 길이를 검사하며 숫자를 반올림하거나 자동 보정하지 않는다', () => {
    expect(normalizeCorrectionEdits(basis(), { ...request('2'), reason: ` ${'x'.repeat(1999)} ` })).toMatchObject({ kind: 'invalid' });
    expect(normalizeCorrectionEdits(basis(), { ...request('2'), reason: 'x'.repeat(2000) })).toMatchObject({ kind: 'valid' });
    expect(normalizeCorrectionEdits(basis(), { ...request('2'), edits: [{ ...request('2').edits[0], evidenceNote: 'x'.repeat(2001) }] })).toMatchObject({ kind: 'invalid' });
  });
  it('draft_accepts_invalid_numeric_text_but_rejects_unknown_rows', () => {
    expect(validateDraftContent(basis(), content())).toEqual({ kind: 'valid', content: content() });
    for (const invalid of [{ ...content(), edits: [{ ...content().edits[0], rowId: 'other' }] }, { ...content(), reason: 'x'.repeat(2001) }, { ...content(), edits: [{ ...content().edits[0], rawValue: 'x'.repeat(2001) }] }, { ...content(), edits: [...content().edits, ...content().edits] }]) {
      expect(validateDraftContent(basis(), invalid)).toMatchObject({ kind: 'invalid' });
    }
    expect(validateDraftContent(basis(), { ...content(), result: 100 } as never)).toMatchObject({ kind: 'invalid' });
    expect(validateDraftContent(basis(), { ...content(), edits: [{ ...content().edits[0], rawValue: 3 }] } as never)).toMatchObject({ kind: 'invalid' });
    expect(validateDraftContent(basis(), { ...content(), edits: Array.from({ length: 10001 }, (_, i) => ({ rowId: `row-${i}`, action: 'set', rawValue: '-' })) })).toMatchObject({ kind: 'invalid' });
    expect(isEmptyDraftContent({ edits: [], reason: '', evidenceNote: '' })).toBe(true);
    expect(isEmptyDraftContent(content())).toBe(false);
    expect(isEmptyDraftContent({ edits: [], reason: '사유', evidenceNote: '' })).toBe(false);
  });
  it('판독불가 자금 항목은 모든 기존 월을 복구해야 한다', () => {
    const first = row({ category: 'cashflow', sourceIdentity: { kind: 'statement', asOf: { year: 2026, month: 8, day: 31 }, item: '기초시재' }, originalValue: null, originalState: 'unreadable', allowedActions: ['set'] });
    const second = { ...first, rowId: 'row-2', period: '2026/07' };
    expect(normalizeCorrectionEdits(basis([first, second]), request('2'))).toMatchObject({ kind: 'invalid', errors: [{ code: 'INCOMPLETE_REPAIR' }] });
    expect(normalizeCorrectionEdits(basis([first, second]), { ...request('2'), edits: [...request('2').edits, { ...request('3').edits[0], rowId: 'row-2' }] })).toMatchObject({ kind: 'valid', patch: [{ value: 2 }, { value: 3 }] });
  });
  it('편집 DTO는 서버 경로와 원천 레코드 ID를 노출하지 않는다', () => {
    const dto = toCorrectionEditorDto(basis());
    expect(dto.basis.reportTitleMonth).toBe('2026/07');
    expect(dto.rows[0]).toEqual({ rowId: 'row-1', category: 'economic', label: '경제 원자료', sourceRound: '2026/08', period: '2026/06', unit: '지수', originalText: '1.0000000000000002', originalState: 'available', allowedActions: ['set', 'set-missing'] });
    expect(JSON.stringify(dto)).not.toContain('sourceRecordId');
    expect(JSON.stringify(dto)).not.toContain('fieldPath');
  });
});

describe('반영 여부와 업무 상태', () => {
  it('already_applied_requires_all_changes_and_semantic_identity', () => {
    const original = basis([row(), row({ rowId: 'row-2', period: '2026/05' })]);
    const patch = [{ rowId: 'row-1', action: 'set' as const, value: 2, reason: '사유', evidenceNote: '' }, { rowId: 'row-2', action: 'set-missing' as const, value: null, reason: '사유', evidenceNote: '' }];
    const current = basis([row({ rowId: 'different-id', sourceRecordId: 'new-capture', originalValue: 2 }), row({ rowId: 'different-id-2', period: '2026/05', originalValue: null, originalState: 'missing' })]);
    expect(correctionPatchAlreadyApplied(original, patch, current)).toBe(true);
    for (const mismatch of [
      { sourceRound: '2026/09' }, { period: '2026/04' }, { unit: '%' }, { originalValue: 3 },
      { sourceIdentity: { kind: 'ecos' as const, indicator: 'test', statistic: 'OTHER', items: ['ITEM'] } },
      { sourceIdentity: { kind: 'ecos' as const, indicator: 'test', statistic: 'STAT', items: ['OTHER'] } },
    ]) expect(correctionPatchAlreadyApplied(original, patch, basis([row({ ...current.rows[0], ...mismatch }), current.rows[1]]))).toBe(false);
    expect(correctionPatchAlreadyApplied(original, patch, basis([current.rows[0]]))).toBe(false);
    expect(correctionPatchAlreadyApplied(original, patch, basis([...current.rows, { ...current.rows[0], rowId: 'ambiguous' }]))).toBe(false);
    expect(correctionPatchAlreadyApplied(basis([...original.rows, { ...original.rows[0], rowId: 'ambiguous-original' }]), patch, current)).toBe(false);
    expect(correctionPatchAlreadyApplied(original, [], current)).toBe(false);
    expect(correctionPatchAlreadyApplied(original, patch, { ...current, basis: { ...current.basis, reportCycle: parseYearMonth('2026/09') } })).toBe(false);
    expect(correctionPatchAlreadyApplied(original, patch, basis([current.rows[0], { ...current.rows[1], originalState: 'unreadable' }]))).toBe(false);
  });
  it('완료 상태는 head가 바뀌어도 다시 미처리되지 않는다', () => {
    expect(correctionWorkState({ confirmationId: 'confirmation-2', resolutionKind: null, hasPreview: true, previewIsCurrent: true, stale: true })).toBe('confirmed');
    expect(correctionWorkState({ confirmationId: null, resolutionKind: 'closed', hasPreview: true, previewIsCurrent: true, stale: true })).toBe('closed');
    expect(correctionWorkState({ confirmationId: null, resolutionKind: 'reflected', hasPreview: true, previewIsCurrent: true, stale: true })).toBe('reflected');
    expect(correctionWorkState({ confirmationId: null, resolutionKind: null, hasPreview: true, previewIsCurrent: true, stale: false })).toBe('pending');
    expect(correctionWorkState({ confirmationId: null, resolutionKind: null, hasPreview: true, previewIsCurrent: false, stale: false })).toBe('draft');
    expect(correctionWorkState({ confirmationId: null, resolutionKind: null, hasPreview: true, previewIsCurrent: true, stale: true })).toBe('stale');
  });
  it('공통 십진 검증은 엑셀 숫자 셀의 지수 표현만 명시적으로 허용한다', () => {
    expect(parseCorrectionDecimal('1e3')).toBeNull();
    expect(parseCorrectionDecimal('1e3', { allowExponent: true })).toBe(1000);
    expect(parseCorrectionDecimal('1e-999', { allowExponent: true })).toBeNull();
    expect(parseCorrectionDecimal('1e999', { allowExponent: true })).toBeNull();
    expect(parseCorrectionDecimal('0e-999', { allowExponent: true })).toBe(0);
  });
});


it('legacy와 웹이 허용 동작·사유·결측·원값 동일성의 단일행 업무 규칙을 공유한다', () => {
  const edit = { rowId: 'row-1', action: 'set' as const, rawValue: '2', evidenceNote: ' 근거 ' };
  expect(normalizeCorrectionRowEdit(row(), edit, ' 사유 ')).toEqual({ kind: 'valid', edit: { rowId: 'row-1', action: 'set', value: 2, reason: '사유', evidenceNote: '근거' } });
  expect(normalizeCorrectionRowEdit(row({ allowedActions: [] }), edit, '사유')).toMatchObject({ kind: 'invalid', errors: [{ field: 'action', code: 'INVALID_ACTION' }] });
  expect(normalizeCorrectionRowEdit(row(), edit, '  ')).toMatchObject({ kind: 'invalid', errors: [{ field: 'reason', code: 'REQUIRED_REASON' }] });
  expect(normalizeCorrectionRowEdit(row(), { ...edit, evidenceNote: 'x'.repeat(2001) }, '사유')).toMatchObject({ kind: 'invalid', errors: [{ field: 'evidenceNote', code: 'LIMIT_EXCEEDED' }] });
  expect(normalizeCorrectionRowEdit(row(), { ...edit, action: 'set-missing', rawValue: '2' }, '사유')).toMatchObject({ kind: 'invalid', errors: [{ field: 'value', code: 'INVALID_NUMBER' }] });
  expect(normalizeCorrectionRowEdit(row(), { ...edit, rawValue: row().originalText }, '사유')).toEqual({ kind: 'no-change' });
  expect(normalizeCorrectionRowEdit(row(), { ...edit, rawValue: '' }, '사유')).toMatchObject({ kind: 'invalid', errors: [{ code: 'INVALID_NUMBER' }] });
  expect(normalizeCorrectionRowEdit(row(), { ...edit, rawValue: '' }, '사유', { blankMeansUnchanged: true })).toEqual({ kind: 'no-change' });
  expect(normalizeCorrectionRowEdit(row(), { ...edit, rawValue: '1e3' }, '사유')).toMatchObject({ kind: 'invalid' });
  expect(normalizeCorrectionRowEdit(row(), { ...edit, rawValue: '1e3' }, '사유', { allowExponent: true })).toMatchObject({ kind: 'valid', edit: { value: 1000 } });
});
