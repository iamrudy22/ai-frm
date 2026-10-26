import { expect, it, vi } from 'vitest';
import type { ExternalHistoryView } from '@/application/report-history/history-view';
import { invalidateHistorySelection } from './use-report-history';
it('correction_success_refreshes_current_history_but_preserves_archived_document', () => {
  const archived = { document: { json: { value: 'fixed old document' } }, historySources: { construction: { confirmed: 1, backfill: 0 } } };
  const original = JSON.stringify(archived);
  const cache = new Map([['current', {} as ExternalHistoryView], ['old selection', {} as ExternalHistoryView]]);
  let revision = 3;
  const advance = vi.fn(() => { revision++; });
  invalidateHistorySelection(cache, advance);
  expect(cache.size).toBe(0);
  expect(revision).toBe(4);
  expect(advance).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(archived)).toBe(original);
});
