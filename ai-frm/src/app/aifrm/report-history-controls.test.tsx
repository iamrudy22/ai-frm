import { describe, expect, it, vi } from 'vitest';
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

it('수정본 파일 선택 안내를 한국어로 표시한다', async () => {
  const { WorkbookCorrectionControls } = await import('./report-history-controls');
  const html = renderToStaticMarkup(<WorkbookCorrectionControls />);
  expect(html).toContain('엑셀 수정본을 놓거나 클릭하여 선택');
  expect(html).not.toContain('Choose file');
});

it('정상 미리보기 다음에 없는 ID를 열면 대기·실패 중 이전 표를 남기지 않고 다시 복구한다', async () => {
  // Exercise the actual handlers without a DOM dependency. Only React hook storage
  // is supplied here; request flow and rendered child elements are the real UI.
  const state: unknown[] = [], refs: { current: unknown }[] = [];
  let slot = 0, refSlot = 0;
  vi.resetModules();
  vi.doMock('react', async importOriginal => ({
    ...await importOriginal<typeof import('react')>(),
    useState: (initial: unknown) => {
      const index = slot++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? (next as (old: unknown) => unknown)(state[index]) : next; }];
    },
    useRef: (initial: unknown) => refs[refSlot++] ?? (refs[refSlot - 1] = { current: initial }),
    useEffect: () => {},
  }));
  type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
  function elements(value: unknown): Element[] {
    if (Array.isArray(value)) return value.flatMap(elements);
    if (!value || typeof value !== 'object' || !('props' in value)) return [];
    const element = value as Element;
    return [element, ...elements(element.props.children)];
  }
  const goodId = '11111111-1111-4111-8111-111111111111';
  const missingId = '00000000-0000-4000-8000-000000000000';
  const saved = { previewId: goodId, baseRevision: 1, rawDiff: [], resultDiff: [], affectedReports: [] };
  let finishMissing: ((response: Response) => void) | undefined;
  const fetchMock = vi.fn(async (url: string) => url.includes(missingId)
    ? new Promise<Response>(resolve => { finishMissing = resolve; })
    : Response.json({ ok: true, preview: saved }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    const { WorkbookCorrectionControls, CorrectionPreviewDetails } = await import('./report-history-controls');
    const render = () => { slot = 0; refSlot = 0; return elements(WorkbookCorrectionControls()); };
    const changeId = (id: string) => (render().find(item => item.props.label === '미리보기 ID')!.props.onChange as (value: string) => void)(id);
    const reopen = () => (render().find(item => item.props.label === '미리보기 열기')!.props.onClick as () => void)();
    const preview = () => render().find(item => item.type === CorrectionPreviewDetails);
    changeId(goodId);
    reopen();
    await vi.waitFor(() => expect(preview()?.props.preview).toEqual(saved));
    expect(renderToStaticMarkup(<CorrectionPreviewDetails preview={preview()!.props.preview as never} confirmation={preview()!.props.confirmation as never}/>)).toContain('저장된 정정 미리보기');
    changeId(missingId);
    reopen();
    expect(preview()).toBeUndefined();
    finishMissing!(Response.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 }));
    await vi.waitFor(() => expect(render().some(item => item.props.children === '파일 또는 미리보기 정보를 확인하세요.')).toBe(true));
    expect(preview()).toBeUndefined();
    changeId(goodId);
    reopen();
    await vi.waitFor(() => expect(preview()?.props.preview).toEqual(saved));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally {
    vi.doUnmock('react');
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
it('정정 확정은 미리보기·전체 사유·명시 클릭 후에만 진행하고 503 재시도는 같은 명령을 쓴다',async()=>{
  const state:unknown[]=[],refs:{current:unknown}[]=[];let slot=0,refSlot=0;
  vi.resetModules();vi.doMock('react',async importOriginal=>({
    ...await importOriginal<typeof import('react')>(),
    useState:(initial:unknown)=>{const index=slot++;if(!(index in state))state[index]=initial;return [state[index],(next:unknown)=>{state[index]=typeof next==='function'?(next as (old:unknown)=>unknown)(state[index]):next;}];},
    useRef:(initial:unknown)=>refs[refSlot++]??(refs[refSlot-1]={current:initial}),useEffect:()=>{},
  }));
  type Element={type:unknown;props:Record<string,unknown>&{children?:unknown}};
  const elements=(value:unknown):Element[]=>Array.isArray(value)?value.flatMap(elements):!value||typeof value!=='object'||!('props'in value)?[]:[value as Element,...elements((value as Element).props.children)];
  const previewId='11111111-1111-4111-8111-111111111111',previewHash='a'.repeat(64);
  const saved={previewId,previewHash,baseRevision:1,rawDiff:[{rowId:'r',before:1,after:2}],resultDiff:[],affectedReports:[]};
  let attempts=0;const commands:string[]=[];const opened:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.includes('exchange?previewId='))return Response.json({ok:true,preview:saved});
    commands.push(String(init?.body));attempts++;
    return attempts===1?Response.json({ok:false,code:'STORAGE_UNAVAILABLE'},{status:503}):Response.json({ok:true,result:{kind:'confirmed',confirmationId:'confirmed-2',revision:2}});
  }));
  try{
    const {WorkbookCorrectionControls}=await import('./report-history-controls');
    const render=()=>{slot=0;refSlot=0;return elements(WorkbookCorrectionControls({onConfirmed:(id:string)=>opened.push(id)}));};
    const field=(label:string)=>render().find(item=>item.props.label===label)!;
    expect(render().some(item=>item.props.label==='정정 확정')).toBe(false);
    (field('미리보기 ID').props.onChange as (value:string)=>void)(previewId);
    (field('미리보기 열기').props.onClick as ()=>void)();
    await vi.waitFor(()=>expect(render().some(item=>item.props.label==='정정 확정')).toBe(true));
    (field('전체 정정 사유').props.onChange as (value:string)=>void)('합성 정정');
    (field('정정 확정').props.onClick as ()=>void)();
    await vi.waitFor(()=>expect(commands).toHaveLength(1));
    await vi.waitFor(()=>expect(field('정정 확정').props['aria-busy']).toBe(false));
    expect(opened).toHaveLength(0);
    expect(render().some(item=>typeof item.props.children==='string'&&item.props.children.includes('재검증'))).toBe(false);
    expect(render().some(item=>typeof item.props.children==='string'&&item.props.children.includes('같은 정정 확정 명령으로 재시도'))).toBe(true);
    (field('정정 확정').props.onClick as ()=>void)();
    await vi.waitFor(()=>expect(opened).toEqual(['confirmed-2']));
    expect(commands[1]).toBe(commands[0]);
    expect(JSON.parse(commands[0])).toMatchObject({previewId,previewHash,expectedBaseRevision:1,reason:'합성 정정'});
    const {CorrectionPreviewDetails}=await import('./report-history-controls');
    const details=render().find(item=>item.type===CorrectionPreviewDetails)!;
    expect(renderToStaticMarkup(<CorrectionPreviewDetails preview={details.props.preview as never} confirmation={details.props.confirmation as never}/>)).toContain('정정 확정됨 · 2차');
  }finally{vi.doUnmock('react');vi.unstubAllGlobals();vi.resetModules();}
});
