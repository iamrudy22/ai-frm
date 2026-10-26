import type { CorrectionEditorRow, CorrectionMonthSummary, CorrectionWorkState, DraftContent } from '@/domain/report-history/correction';
import { addMonths, parseYearMonth } from '@/domain/shared/year-month';
export const WORK_LABEL: Record<CorrectionWorkState, string> = { draft: '작성 중', pending: '확정 대기', stale: '비교 필요', confirmed: '확정 완료', closed: '검토 종료', reflected: '이미 반영됨' };
export type EditorFilter = {
  round: string;
  period: string;
  query: string;
  changedOnly: boolean;
};
export const emptyFilters = (): EditorFilter => ({ round: 'all', period: 'all', query: '', changedOnly: false });
export function monthRange(period: string, latestTitle: string, pendingOnly = false): {
  fromCycle?: string;
  toCycle?: string;
} {
  if (pendingOnly || period === 'all')
    return {};
  const latest = parseYearMonth(latestTitle);
  const from = period === 'recent' ? addMonths(latest, -11) : parseYearMonth(`${period}/01`);
  const to = period === 'recent' ? latest : parseYearMonth(`${period}/12`);
  return { fromCycle: addMonths(from, 1), toCycle: addMonths(to, 1) };
}
export function primaryMonthAction(month: CorrectionMonthSummary) {
  return month.draftCount === 1 && month.resumeRef?.kind === 'draft' ? { label: '이어서 작성', ref: month.resumeRef } : { label: '수정안 보기', ref: null };
}
export function updateDraftEdit(content: DraftContent, rowId: string, value: string | null): DraftContent {
  const edits = content.edits.filter(edit => edit.rowId !== rowId);
  if (value !== '')
    edits.push({ rowId, action: value === null ? 'set-missing' : 'set', rawValue: value });
  return { ...content, edits };
}
export function filterEditorRows(rows: readonly CorrectionEditorRow[], category: CorrectionEditorRow['category'], filter: EditorFilter, content: DraftContent) {
  return rows.filter(row => row.category === category && (filter.round === 'all' || row.sourceRound === filter.round) && (filter.period === 'all' || row.period === filter.period) && (!filter.changedOnly || content.edits.some(edit => edit.rowId === row.rowId)) && `${row.label} ${row.sourceRound} ${row.period} ${row.unit}`.toLocaleLowerCase().includes(filter.query.toLocaleLowerCase()));
}
export const originalValue = (row: Pick<CorrectionEditorRow, 'originalText' | 'originalState'>) => row.originalState === 'missing' ? '값 없음' : row.originalState === 'unreadable' ? '판독 불가' : row.originalText;
export const proposalValue = (action: string, text: string | null) => action === 'set-missing' ? '값 없음' : text === '' ? '변경 없음' : text ?? '변경 없음';
export const workKey = (ref: {
  kind: string;
  id: string;
}) => `${ref.kind}:${ref.id}`;
export function mergePage<T>(previous: readonly T[], next: readonly T[], key: (item: T) => string): T[] { const seen = new Set(previous.map(key)); return [...previous, ...next.filter(item => !seen.has(key(item)) && !!seen.add(key(item)))]; }
