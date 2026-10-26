import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CorrectionReviewDetails, CorrectionWorkTable, CorrectionEditor } from './report-correction-editor';
import { CorrectionSession, CorrectionClientError } from './use-report-correction';
import type { CorrectionReviewDetail, CorrectionEditorDto } from '@/domain/report-history/correction';
const summary = { ref: { kind: 'draft', id: 'opaque' }, state: 'closed', reportCycle: '2026/01', reportTitleMonth: '2025/12', baseRevision: 1, createdAt: 'date', savedAt: 'date', summary: '기초시재 · 2025/12 · 1→0 · 억원', inputCount: 2, validChangeCount: null, capabilities: { resume: false, view: true, copy: true, close: false } } as const;
const detail = { summary, reason: '합성 사유', evidenceNote: '근거', preview: null, confirmationId: null, resolvedAt: 'date', rows: [{ rowId: 'r', category: 'cashflow', label: '기초시재', sourceRound: '2026/01', period: '2025/12', unit: '억원', originalText: '1.000000000000001', originalState: 'available', allowedActions: ['set'], proposedAction: 'set', proposedText: '0', evidenceNote: '근거', current: { originalText: '2', originalState: 'available' } }] } as CorrectionReviewDetail;
it('summary_identifies_item_period_before_after and invalid raw input count is not validated changes', () => {
  const html = renderToStaticMarkup(<CorrectionWorkTable items={[summary]} onView={vi.fn()} onResume={vi.fn()} onClose={vi.fn()} onCopy={vi.fn()}/>);
  expect(html).toContain('기초시재');
  expect(html).toContain('2025/12');
  expect(html).toContain('1→0');
  expect(html).toContain('억원');
  expect(html).toContain('미검증 입력 2개');
  expect(html).toContain('내용 보기');
  expect(html).toContain('새 수정안으로 다시 검토');
  expect(html).not.toContain('opaque');
});
it('closed_detail_is_read_only_and_copy_is_separate with original proposal current comparison', () => {
  const html = renderToStaticMarkup(<CorrectionReviewDetails detail={detail} comparison/>);
  expect(html).toContain('1.000000000000001');
  expect(html).toContain('>0<');
  expect(html).toContain('>2<');
  expect(html).toContain('시작값');
  expect(html).toContain('최신값');
  expect(html).toContain('제안값');
  expect(html).toContain('합성 사유');
  expect(html).not.toContain('<input');
  expect(html).not.toContain('정정 확정');
});
it('editor uses full precision text inputs, explicit missing and tab filters outside print', () => {
  const editor = { basisId: 'id', baseConfirmationId: 'head', baseRevision: 1, basis: { reportCycle: '2026/01', reportTitleMonth: '2025/12' }, rows: detail.rows.map(row => ({ ...row, allowedActions: ['set', 'set-missing'] })) } as unknown as CorrectionEditorDto;
  const session = new CorrectionSession(editor, null, {} as never);
  const html = renderToStaticMarkup(<CorrectionEditor session={session} onLeave={vi.fn()} onConfirmed={vi.fn()}/>);
  expect(html).toContain('report-controls');
  expect(html).toContain('자금자료');
  expect(html).toContain('경제지표');
  expect(html).toContain('조달금리');
  expect(html).toContain('1.000000000000001');
  expect(html).toContain('type="text"');
  expect(html).not.toContain('type="number"');
  expect(html).toContain('값 없음');
  expect(html).not.toContain('정정용 엑셀');
});
it('detail request completion moves focus into loaded content and close returns to its actual trigger while retaining list controls', async () => {
  // Execute actual screen actions/effects with hook storage, without a simulated DOM.
  // Real browser geometry/focus is independently checked by the root's 60-month QA.
  vi.resetModules();
  const state: unknown[] = [], refs: {
    current: unknown;
  }[] = [], memos: {
    deps: unknown[];
    value: unknown;
  }[] = [], effectDeps: unknown[][] = [];
  let stateSlot = 0, refSlot = 0, memoSlot = 0, effectSlot = 0;
  let effects: (() => void)[] = [];
  const equal = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  vi.doMock('react', async (original) => ({
    ...await original<typeof import('react')>(),
    useState: (initial: unknown) => { const index = stateSlot++; if (!(index in state))
      state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial; return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? (next as (old: unknown) => unknown)(state[index]) : next; }]; },
    useRef: (initial: unknown) => refs[refSlot++] ?? (refs[refSlot - 1] = { current: initial }),
    useMemo: (factory: () => unknown, deps: unknown[]) => { const index = memoSlot++; if (!memos[index] || !equal(memos[index].deps, deps))
      memos[index] = { deps, value: factory() }; return memos[index].value; },
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void, deps: unknown[]) => { const index = effectSlot++; if (!effectDeps[index] || !equal(effectDeps[index], deps)) {
      effectDeps[index] = deps;
      effects.push(effect);
    } },
  }));
  vi.doMock('@astryxdesign/core/Table', async (original) => ({ ...await original<typeof import('@astryxdesign/core/Table')>(), useTableRowExpansion: (config: unknown) => config, useTableStickyColumns: () => ({}) }));
  const events: string[] = [];
  const trigger = { isConnected: true, focus: () => events.push('trigger-focus'), scrollIntoView: () => events.push('trigger-visible') };
  const target = { focus: () => events.push('detail-focus'), scrollIntoView: () => events.push('detail-visible') };
  const month = { reportCycle: '2026/01', reportTitleMonth: '2025/12', latestConfirmationId: 'head', latestRevision: 1, pendingCount: 1, draftCount: 1, resumeRef: { kind: 'draft', id: 'opaque' } };
  let resolveDetail!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('refKind=') ? new Promise<Response>(resolve => { resolveDetail = resolve; }) : Response.json({ ok: true, items: [month], nextCursor: null })));
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1; });
  type Element = {
    type: unknown;
    props: Record<string, unknown>;
  };
  const elements = (value: unknown): Element[] => Array.isArray(value) ? value.flatMap(elements) : value && typeof value === 'object' && 'props' in value ? [value as Element, ...Object.values((value as Element).props).flatMap(elements)] : [];
  try {
    const { ReportCorrectionControls, CorrectionWorkTable } = await import('./report-correction-editor');
    const render = () => { stateSlot = 0; refSlot = 0; memoSlot = 0; effectSlot = 0; const tree = elements(ReportCorrectionControls({ confirmations: [], onOpen: vi.fn(), onConfirmed: vi.fn() })); for (const node of tree)
      if (node.props.children === '수정안 내용 보기')
        (node.props.ref as {
          current: unknown;
        }).current = target; const pending = effects; effects = []; pending.forEach(effect => effect()); return tree; };
    render();
    await vi.waitFor(() => expect((render().find(node => node.props.idKey === 'reportCycle')!.props.data as unknown[]).length).toBe(1));
    const table = render().find(node => node.props.idKey === 'reportCycle')!;
    const plugin = (table.props.plugins as {
      expansion: {
        onToggle: (key: string) => void;
        renderExpanded: (month: unknown) => Element;
      };
    }).expansion;
    plugin.onToggle('2026/01');
    const workProps = plugin.renderExpanded(month).props;
    // The real work action forwards its own currentTarget, not whichever element later has focus.
    stateSlot = 100;
    refSlot = 100;
    memoSlot = 100;
    effectSlot = 100;
    const workTable = CorrectionWorkTable({ items: [summary], onView: workProps.onView as never, onResume: vi.fn(), onClose: vi.fn(), onCopy: vi.fn() });
    const actionColumn = (workTable.props.columns as {
      key: string;
      renderCell: (row: unknown) => unknown;
    }[]).find(column => column.key === 'actions')!;
    const action = elements(actionColumn.renderCell(summary)).find(node => node.props.label === '내용 보기')!;
    (action.props.onClick as (event: unknown) => void)({ currentTarget: trigger });
    expect(events).toEqual([]);
    resolveDetail(Response.json({ ok: true, detail }));
    await vi.waitFor(() => expect(render().some(node => node.props.children === '수정안 내용 보기')).toBe(true));
    expect(events).toEqual(['detail-focus', 'detail-visible']);
    const current = render();
    const close = current.find(node => node.props.label === '내용 닫기')!;
    (close.props.onClick as () => void)();
    render();
    expect(events.slice(-2)).toEqual(['trigger-focus', 'trigger-visible']);
    const retained = render().find(node => node.props.idKey === 'reportCycle')!;
    expect((retained.props.data as typeof month[])[0].reportTitleMonth).toBe('2025/12');
    expect((retained.props.plugins as {
      expansion: {
        expandedKeys: Set<string>;
      };
    }).expansion.expandedKeys.has('2026/01')).toBe(true);
    expect(render().find(node => node.props.label === '보고 기간')?.props.value).toBe('recent');
  }
  finally {
    vi.doUnmock('react');
    vi.doUnmock('@astryxdesign/core/Table');
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
it('conflict comparison shows preserved local proposal and latest readonly content without automatic writes', async () => {
  const editor = { basisId: 'b', baseRevision: 1, baseConfirmationId: 'head', basis: { reportCycle: '2026/01', reportTitleMonth: '2025/12' }, rows: detail.rows } as unknown as CorrectionEditorDto;
  const client = { save: vi.fn(async () => { throw new CorrectionClientError(409, 'STALE_DRAFT'); }), resume: vi.fn(async () => ({ draftId: 'd', draftRevision: 3, editor, content: { edits: [], reason: '다른 탭의 사유', evidenceNote: '' }, requiresReapply: false })), detail: vi.fn(async () => ({ ...detail, reason: '다른 탭의 사유' })) };
  const session = new CorrectionSession(editor, { draftId: 'd', draftRevision: 1, editor, content: { edits: [], reason: '시작', evidenceNote: '' }, requiresReapply: false } as never, client as never);
  session.change({ edits: [{ rowId: 'r', action: 'set', rawValue: '-.' }], reason: '내가 입력한 사유', evidenceNote: '' });
  await expect(session.drain()).rejects.toThrow();
  await session.readConflictLatest();
  const html = renderToStaticMarkup(<CorrectionEditor session={session} onLeave={vi.fn()} onConfirmed={vi.fn()}/>);
  expect(html).toContain('내 미보관 입력');
  expect(html).toContain('내가 입력한 사유');
  expect(html).toContain('서버의 최신 내용');
  expect(html).toContain('다른 탭의 사유');
  expect(html).toContain('서버의 최신 내용으로 전환');
  expect(html).not.toContain('저장 다시 시도');
  expect(client.save).toHaveBeenCalledTimes(1);
  expect(session.snapshot.content.reason).toBe('내가 입력한 사유');
});

it('rows without set permission disable the actual Astryx numeric input, including missing-only rows', () => {
  const editor = {basisId:'id',baseConfirmationId:'head',baseRevision:1,basis:{reportCycle:'2026/01',reportTitleMonth:'2025/12'},rows:detail.rows.flatMap(row=>[{...row,rowId:'locked',label:'조회 실패',allowedActions:[]},{...row,rowId:'missing-only',label:'결측 전용',allowedActions:['set-missing']}])} as unknown as CorrectionEditorDto;
  const session = new CorrectionSession(editor,null,{} as never);
  const html = renderToStaticMarkup(<CorrectionEditor session={session} onLeave={vi.fn()} onConfirmed={vi.fn()}/>);
  for(const label of ['조회 실패','결측 전용']) {
    const labelMarkup = [...html.matchAll(/<label[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g)].find(match=>match[2].includes(`${label} ·`));
    expect(labelMarkup).toBeDefined();
    const input = [...html.matchAll(/<input[^>]*>/g)].find(match=>match[0].includes(`id="${labelMarkup![1]}"`))?.[0];
    expect(input).toContain('disabled');
  }
});

it('editor and read-only legacy details render all five stored metrics, grade, unavailable and real saved impact', async () => {
  const comparison = {previewId:'p',previewHash:'hash',draftRevision:1,baseRevision:1,rawDiff:[{rowId:'r',label:'저장 항목',sourceRound:'2026/01',period:'2025/12',unit:'억원',before:1,after:0,reason:'사유',evidenceNote:''}],
    resultDiff:[{indicator:'recovery',beforeDisplay:'1 · 양호',afterDisplay:'2 · 보통',changed:true},{indicator:'liquidity',beforeDisplay:'3',afterDisplay:'4',changed:true},{indicator:'cash',beforeDisplay:'5',afterDisplay:'6',changed:true},{indicator:'construction',beforeDisplay:'산출불가 · 조회 실패',afterDisplay:'7 · 주의',changed:true},{indicator:'funding',beforeDisplay:'8 · 위기',afterDisplay:'8 · 위기',changed:false}],
    affectedReports:[{reportCycle:'2025/11',revision:3,indicator:'construction',status:'not-recalculated',reason:'저장된 영향 안내'}]};
  const editor={basisId:'id',baseConfirmationId:'head',baseRevision:1,basis:{reportCycle:'2026/01',reportTitleMonth:'2025/12'},rows:detail.rows} as unknown as CorrectionEditorDto;
  const session=new CorrectionSession(editor,{draftId:'d',draftRevision:1,editor,content:{edits:[],reason:'사유',evidenceNote:''},currentPreviewId:'p',requiresReapply:false} as never,{detail:async()=>({...detail,summary:{...summary,ref:{kind:'draft',id:'d'},state:'pending',capabilities:{...summary.capabilities,resume:true}},preview:comparison})} as never);
  await session.loadSavedPreview();expect(session.canConfirm).toBe(true);
  const editHtml=renderToStaticMarkup(<CorrectionEditor session={session} onLeave={vi.fn()} onConfirmed={vi.fn()}/>);
  const readonlyHtml=renderToStaticMarkup(<CorrectionReviewDetails detail={{...detail,summary:{...summary,ref:{kind:'legacy-preview',id:'old'}},preview:{...comparison,draftRevision:null}}}/>);
  for(const html of [editHtml,readonlyHtml]) {
    for(const label of ['저장 항목 · 자료 2026/01 · 2025/12','대금 회수 위험','유동성 Gap','적정 시재','건설경기 인식 지수','조달위험 인식 지수','2 · 보통','산출불가 · 조회 실패','8 · 위기','다른 보고서 영향','2025/11','저장된 영향 안내','영향 가능 · 재계산 불가']) expect(html).toContain(label);
  }
  expect(readonlyHtml).not.toContain('<input');expect(readonlyHtml).not.toContain('정정 확정');session.dispose();
});
