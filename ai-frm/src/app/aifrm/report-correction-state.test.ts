import { expect, it } from 'vitest';
import { monthRange, primaryMonthAction, updateDraftEdit, filterEditorRows, emptyFilters } from './report-correction-state';
import type { CorrectionMonthSummary, CorrectionEditorRow } from '@/domain/report-history/correction';
it('existing_draft_is_resumed_by_primary_action and new_draft_requires_explicit_action', () => {
  const month = { draftCount: 1, resumeRef: { kind: 'draft', id: 'same' } } as CorrectionMonthSummary;
  expect(primaryMonthAction(month)).toEqual({ label: '이어서 작성', ref: month.resumeRef });
  expect(primaryMonthAction({ ...month, draftCount: 2 })).toEqual({ label: '수정안 보기', ref: null });
});
it('report_title_year_filter_preserves_source_cycle_mapping and recent12 calendar window uses stored latest', () => {
  expect(monthRange('2025', '2030/05')).toEqual({ fromCycle: '2025/02', toCycle: '2026/01' });
  expect(monthRange('recent', '2025/12')).toEqual({ fromCycle: '2025/02', toCycle: '2026/01' });
  expect(monthRange('all', '2025/12')).toEqual({});
  expect(monthRange('2025', '2025/12', true)).toEqual({});
});
it('tab_filters_and_hidden_edits_survive_switch and blank / zero / missing differ', () => {
  const rows = [{ rowId: 'a', category: 'cashflow', sourceRound: '2026/01', period: '2025/12', label: '시재' }, { rowId: 'b', category: 'economic', sourceRound: '2026/01', period: '2025/11', label: '생산' }] as CorrectionEditorRow[];
  const content = { edits: [], reason: '', evidenceNote: '' };
  const zero = updateDraftEdit(content, 'a', '0');
  expect(zero.edits[0].rawValue).toBe('0');
  expect(updateDraftEdit(zero, 'a', '').edits).toEqual([]);
  expect(updateDraftEdit(zero, 'b', null).edits[1]).toMatchObject({ action: 'set-missing', rawValue: null });
  expect(filterEditorRows(rows, 'economic', emptyFilters(), zero)).toEqual([rows[1]]);
  expect(zero.edits[0].rawValue).toBe('0');
});
