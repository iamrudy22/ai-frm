import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportHistoryControls } from './report-history-controls';
import { historySelectionErrorMessage, type useReportHistory } from './use-report-history';

const noop = () => {};
describe('history controls outside printable paper', () => {
  it('keeps details collapsed and exposes status, progress and explicit resume actions', () => {
    const history = { batches: [{ batchId: 'batch', startKey: 'key', scopeId: 'default', fromCycle: '2026/08', toCycle: '2026/09', completedCycles: ['2026/08'], pendingCycles: ['2026/09'], status: 'running' }],
      plan: { cycles: ['2026/08', '2026/09'], readiness: [{ reportCycle: '2026/08', missingRounds: ['2026/06'], localReason: '합성 부족' }] },
      selectedBatchId: 'batch', view: null, status: '1/2회차 보완 완료', error: null, running: false, refresh: noop, prepare: noop, start: noop, resume: noop, cancel: noop, applyBatch: noop, canStart: true, range: '2025/04~2026/09', unreadableRounds: 1 } as unknown as ReturnType<typeof useReportHistory>;
    const html = renderToStaticMarkup(<ReportHistoryControls history={history} />);
    expect(html).toContain('report-controls');
    expect(html).toContain('1/2회차 보완 완료');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('작업 명시적 재개');
    expect(html).toContain('과거 18회차 보완 시작');
    expect(html).toContain('2025/04~2026/09');
    expect(html).toContain('가능한 달은 산출');
    expect(html).toContain('보완 범위·준비 상태와 기존 작업');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('report-sheet');
  });
  it('shows preparation before a source-start action', () => {
    const history = { batches: [], plan: null, selectedBatchId: null, view: null, status: '대기', error: null, running: false, refresh: noop, prepare: noop, start: noop, resume: noop, cancel: noop, applyBatch: noop, canStart: true, range: '2025/04~2026/09', unreadableRounds: 0 } as unknown as ReturnType<typeof useReportHistory>;
    const html = renderToStaticMarkup(<ReportHistoryControls history={history} />);
    expect(html).toContain('보완 준비 확인');
    expect(html).not.toContain('과거 18회차 보완 시작');
  });
  it('keeps a completed batch from a restored list available for explicit selection', () => {
    const history = { batches: [{ batchId: 'saved', startKey: 'key', scopeId: 'default', fromCycle: '2026/08', toCycle: '2026/08', completedCycles: ['2026/08'], pendingCycles: [], status: 'completed' }],
      plan: null, selectedBatchId: null, view: null, status: '대기', error: null, running: false, refresh: noop, prepare: noop, start: noop, resume: noop, cancel: noop, applyBatch: noop, canStart: false, range: null, unreadableRounds: 0 } as unknown as ReturnType<typeof useReportHistory>;
    const html = renderToStaticMarkup(<ReportHistoryControls history={history} />);
    expect(html).toContain('2026/08 작업 이력 선택');
    expect(html).not.toContain('2026/08 작업 명시적 재개');
  });
  it.each([
    ['BATCH_RANGE_MISMATCH', '범위'],
    ['BATCH_VERSION_MISMATCH', '계산 버전'],
    ['HISTORY_NOT_FOUND', '찾지 못했습니다'],
  ])('explains %s and a usable batch alternative in Korean', (code, cause) => {
    const message = historySelectionErrorMessage(code);
    const history = { batches: [], plan: null, selectedBatchId: 'batch', view: null, status: '이력 선택 실패', error: message, running: false, refresh: noop, prepare: noop, start: noop, resume: noop, cancel: noop, applyBatch: noop, canStart: false, range: null, unreadableRounds: 0 } as unknown as ReturnType<typeof useReportHistory>;
    const html = renderToStaticMarkup(<ReportHistoryControls history={history} />);
    expect(html).toContain(cause);
    expect(html).toContain('다른 작업을 선택하거나 보완을 제외');
    expect(html).not.toContain(code);
  });
});
