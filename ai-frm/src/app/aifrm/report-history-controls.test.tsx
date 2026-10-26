import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportHistoryControls, ReportHistorySourceSummary } from './report-history-controls';
import { historySelectionErrorMessage, type useReportHistory } from './use-report-history';

const noop = () => {};
describe('history controls outside printable paper', () => {
  it('shows separate visible source counts for current and archived documents outside the paper', () => {
    const summary = { construction: { confirmed: 1, backfill: 2, unconfirmed: 0, current: 1 }, funding: { confirmed: 3, backfill: 0, unconfirmed: 1, current: 0 } };
    const archived = renderToStaticMarkup(<ReportHistorySourceSummary summary={summary} archived />);
    expect(archived).toContain('저장된 확정 문서');
    expect(archived).toContain('건설경기');
    expect(archived).toContain('확정 1개월');
    expect(archived).toContain('보완 2개월');
    expect(archived).toContain('조달위험');
    expect(archived).toContain('미확정 이력 1개월');
    expect(archived).not.toContain('보완 시작');
    expect(archived).not.toContain('확정 저장 이력 기준');
    const current = renderToStaticMarkup(<ReportHistorySourceSummary summary={summary} />);
    expect(current).toContain('현재 보고서');
    expect(current).toContain('현재 산출 1개월');
  });
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

it('정정 미리보기는 원자료 0/결측·사유·결과불가·영향을 표로 제공하고 확정으로 표시하지 않는다',async()=>{
  const components=await import('./report-history-controls');
  const Details=(components as unknown as {CorrectionPreviewDetails?: React.ComponentType<{preview:unknown;confirmation?:{kind:'confirmed';revision:number}|{kind:'unconfirmed'|'unknown'}}>}).CorrectionPreviewDetails;
  const preview={previewId:'preview',baseRevision:1,rawDiff:[{rowId:'r1',sheet:'조달금리_정정',identity:{date:'2026/08/31',bond:'publicAaa'},unit:'%',before:3.674,after:0,reason:'합성 정정',evidenceNote:'공표값 확인'},{rowId:'r2',sheet:'경제지표_정정',identity:{month:'2026/07',indicator:'총수주액'},unit:'지수',before:2,after:null,reason:'합성 결측',evidenceNote:''}],resultDiff:[{indicator:'funding',changed:true,beforeDisplay:'1.174 · 정상',afterDisplay:'산출불가 · 마지막 평가일 결측'}],affectedReports:[{confirmationId:'other',reportCycle:'2026/08',revision:1,indicator:'construction',status:'possible',reason:'저장된 평가 문맥 확인 필요'}]};
  const html=Details?renderToStaticMarkup(<Details preview={preview}/>):'';
  expect(html).toContain('3.674');expect(html).toContain('>0<');expect(html).toContain('결측');expect(html).toContain('합성 정정');expect(html).toContain('산출불가');expect(html).toContain('2026/08');expect(html).toContain('<table');expect(html).not.toContain('정정 확정');expect(html).not.toContain('확정됨');
  expect(html).toContain('저장된 정정 미리보기');expect(html).not.toContain('미확정');
  const newlyValidated=Details?renderToStaticMarkup(<Details preview={preview} confirmation={{kind:'unconfirmed'}}/>):'';
  expect(newlyValidated).toContain('검증 완료 · 미확정');
  const confirmed=Details?renderToStaticMarkup(<Details preview={preview} confirmation={{kind:'confirmed',revision:2}}/>):'';
  expect(confirmed).toContain('정정 확정됨 · 2차');expect(confirmed).not.toContain('미확정');
});
