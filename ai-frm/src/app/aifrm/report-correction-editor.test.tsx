import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CorrectionReviewDetails, CorrectionWorkTable, CorrectionEditor } from './report-correction-editor';
import { CorrectionSession, CorrectionClientError } from './use-report-correction';
import type { CorrectionReviewDetail, CorrectionEditorDto } from '@/domain/report-history/correction';
const summary = { ref: { kind: 'draft', id: 'opaque' }, state: 'closed', reportCycle: '2026/01', reportTitleMonth: '2025/12', baseRevision: 1, createdAt: 'date', savedAt: 'date', summary: '기초시재 · 2025/12 · 1→0 · 억원', inputCount: 2, validChangeCount: null, capabilities: { resume: false, view: true, copy: true, close: false } } as const;
const detail = { summary, reason: '합성 사유', evidenceNote: '근거', preview: null, confirmationId: null, resolvedAt: 'date', rows: [{ rowId: 'r', category: 'cashflow', label: '기초시재', sourceRound: '2026/01', period: '2025/12', unit: '억원', originalText: '1.000000000000001', originalState: 'available', allowedActions: ['set'], proposedAction: 'set', proposedText: '0', evidenceNote: '근거', current: { originalText: '2', originalState: 'available' } }] } as CorrectionReviewDetail;
type TestElement = { type: unknown; props: Record<string, unknown> };
const elements = (value: unknown): TestElement[] => Array.isArray(value) ? value.flatMap(elements) : value && typeof value === 'object' && 'props' in value ? [value as TestElement, ...Object.values((value as TestElement).props).flatMap(elements)] : [];
const navigationMonth = { reportCycle: '2026/01', reportTitleMonth: '2025/12', latestConfirmationId: 'head', latestRevision: 1, pendingCount: 1, draftCount: 1, resumeRef: { kind: 'draft', id: 'opaque' } };
const navigationEditor = { basisId: 'basis', baseConfirmationId: 'head', baseRevision: 1, basis: { reportCycle: '2026/01', reportTitleMonth: '2025/12' }, rows: detail.rows } as unknown as CorrectionEditorDto;
const navigationDraft = { draftId: 'opaque', draftRevision: 1, editor: navigationEditor, content: { edits: [], reason: '보관 사유', evidenceNote: '' }, requiresReapply: false };
type CorrectionScreen = {
  render: () => TestElement[];
  owner: () => Parameters<typeof CorrectionEditor>[0] | undefined;
  edit: (value: string) => void;
  editorAction: (label: string) => void;
  editorControls: () => TestElement[];
  monthAction: (label: string) => void;
  workAction: (name: 'onView' | 'onCopy' | 'onClose') => void;
  navigate: () => Promise<boolean>;
  events: string[];
  handoffs: Promise<boolean>[];
};
async function withCorrectionScreen(request: (url: string, init?: RequestInit) => Promise<Response>, run: (screen: CorrectionScreen) => Promise<void>) {
  // Reuse the hook-storage screen harness below, keeping the real session and HTTP client.
  vi.resetModules();
  const state: unknown[] = [], refs: { current: unknown }[] = [], memos: { deps: unknown[]; value: unknown }[] = [], effectDeps: unknown[][] = [], cleanups: (void | (() => void))[] = [];
  let stateSlot = 0, refSlot = 0, memoSlot = 0, effectSlot = 0;
  let effects: (() => void)[] = [];
  const equal = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory: () => unknown, deps: unknown[]) => { const index = memoSlot++; if (!memos[index] || !equal(memos[index].deps, deps)) memos[index] = { deps, value: factory() }; return memos[index].value; };
  vi.doMock('react', async original => ({
    ...await original<typeof import('react')>(),
    useState: (initial: unknown) => { const index = stateSlot++; if (!(index in state)) state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial; return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? (next as (old: unknown) => unknown)(state[index]) : next; }]; },
    useRef: (initial: unknown) => refs[refSlot++] ?? (refs[refSlot - 1] = { current: initial }),
    useMemo: memo,
    useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const index = effectSlot++; if (!effectDeps[index] || !equal(effectDeps[index], deps)) { effectDeps[index] = deps; effects.push(() => { cleanups[index]?.(); cleanups[index] = effect(); }); } },
  }));
  vi.doMock('@astryxdesign/core/Table', async original => ({ ...await original<typeof import('@astryxdesign/core/Table')>(), useTableRowExpansion: (config: unknown) => config, useTableStickyColumns: () => ({}) }));
  vi.doMock('@astryxdesign/core/hooks', async original => ({ ...await original<typeof import('@astryxdesign/core/hooks')>(), useMediaQuery: () => false }));
  vi.stubGlobal('fetch', request);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1; });
  const events: string[] = [];
  const trigger = { isConnected: true, focus: () => events.push('trigger-focus'), scrollIntoView: () => events.push('trigger-visible') };
  const sessions = new Set<CorrectionSession>();
  const handoffs: Promise<boolean>[] = [];
  let guard: (() => Promise<boolean>) | null = null;
  const registerNavigationGuard = (next: typeof guard) => { guard = next; };
  try {
    const correctionModule = await import('./report-correction-editor');
    const render = () => {
      stateSlot = refSlot = memoSlot = effectSlot = 0;
      const tree = elements(correctionModule.ReportCorrectionControls({ confirmations: [], onOpen: () => events.push('open'), onConfirmed: () => { events.push('confirmed'); handoffs.push(guard?.() ?? Promise.resolve(true)); }, registerNavigationGuard, onNewManualEntry: () => events.push('past-entry') }));
      const pending = effects; effects = []; pending.forEach(effect => effect());
      for (const node of tree) if (node.type === correctionModule.CorrectionEditor) sessions.add((node.props as Parameters<typeof CorrectionEditor>[0]).session);
      return tree;
    };
    const owner = () => render().find(node => node.type === correctionModule.CorrectionEditor)?.props as Parameters<typeof CorrectionEditor>[0] | undefined;
    const monthAction = (label: string) => {
      const table = render().find(node => node.props.idKey === 'reportCycle')!;
      const columns = table.props.columns as { key: string; renderCell: (month: unknown) => unknown }[];
      const button = elements(columns.find(column => column.key === 'actions')!.renderCell(navigationMonth)).find(node => node.props.label === label)!;
      (button.props.onClick as (event: unknown) => void)({ currentTarget: trigger });
    };
    const workAction = (name: 'onView' | 'onCopy' | 'onClose') => {
      const table = render().find(node => node.props.idKey === 'reportCycle')!;
      const expansion = (table.props.plugins as { expansion: { renderExpanded: (month: unknown) => TestElement } }).expansion;
      (expansion.renderExpanded(navigationMonth).props[name] as (ref: unknown, trigger: unknown) => void)(summary.ref, trigger);
    };
    const editorTree = () => {
      const props = owner()!;
      stateSlot = refSlot = memoSlot = effectSlot = 1000;
      const tree = elements(correctionModule.CorrectionEditor(props));
      effects = []; // Child effects belong to browser mounting; this harness executes the real edit action.
      return tree;
    };
    const edit = (value: string) => {
      const tree = editorTree();
      const table = tree.find(node => node.props.idKey === 'rowId')!;
      const columns = table.props.columns as { key: string; renderCell: (row: unknown) => unknown }[];
      const input = elements(columns.find(column => column.key === 'value')!.renderCell(navigationEditor.rows[0])).find(node => node.props.placeholder === '빈칸은 변경 없음')!;
      (input.props.onChange as (value: string) => void)(value);
    };
    const editorAction = (label: string) => { const button = editorTree().find(node => node.props.label === label)!; (button.props.onClick as () => void)(); };
    render();
    await vi.waitFor(() => expect(render().some(node => node.props.idKey === 'reportCycle')).toBe(true));
    await run({ render, owner, edit, editorAction, editorControls: editorTree, monthAction, workAction, navigate: () => guard?.() ?? Promise.resolve(true), events, handoffs });
  }
  finally {
    sessions.forEach(session => session.dispose());
    cleanups.forEach(cleanup => cleanup?.());
    vi.doUnmock('react'); vi.doUnmock('@astryxdesign/core/Table'); vi.doUnmock('@astryxdesign/core/hooks'); vi.unstubAllGlobals(); vi.resetModules();
  }
}
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

it('external navigation waits for the edited raw value ACK then removes the correction owner without restoring its trigger', async () => {
  let acknowledge!: (response: Response) => void;
  let saved: { content: typeof navigationDraft.content } | undefined;
  await withCorrectionScreen(async (url, init) => {
    const command = init?.body ? JSON.parse(String(init.body)) : null;
    if (command?.action === 'open') return Response.json({ ok: true, editor: navigationEditor });
    if (command?.action === 'create') { saved = command; return new Promise(resolve => { acknowledge = resolve; }); }
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.monthAction('새 수정안');
    await vi.waitFor(() => expect(screen.owner()).toBeDefined());
    screen.edit('-.');
    const session = screen.owner()!.session;
    let left = false;
    const leave = screen.navigate().then(result => { left = result; return result; });
    await vi.waitFor(() => expect(saved).toBeDefined());
    expect(saved!.content.edits).toEqual([{ rowId: 'r', action: 'set', rawValue: '-.' }]);
    expect(left).toBe(false);
    expect(screen.owner()?.session).toBe(session);
    acknowledge(Response.json({ ok: true, draft: { ...navigationDraft, content: saved!.content } }));
    expect(await leave).toBe(true);
    expect(session.snapshot.content.edits[0].rawValue).toBe('-.');
    expect(session.hasUnacknowledged).toBe(false);
    expect(screen.owner()).toBeUndefined();
    expect(screen.events).toEqual([]);
  });
});

it.each([
  { name: 'storage failure', status: 500, code: 'STORAGE_UNAVAILABLE' },
  { name: 'conflict', status: 409, code: 'STALE_DRAFT' },
  { name: 'unknown response', status: 0, code: 'NETWORK' },
])('external navigation preserves the real correction editor and raw input after $name', async ({ status, code }) => {
  await withCorrectionScreen(async (url, init) => {
    const command = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.includes('draftId=')) return Response.json({ ok: true, draft: navigationDraft });
    if (url.includes('refKind=')) return Response.json({ ok: true, detail });
    if (command?.action === 'save') {
      if (!status) throw new TypeError('Network response lost');
      return Response.json({ ok: false, code }, { status });
    }
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.monthAction('이어서 작성');
    await vi.waitFor(() => expect(screen.owner()).toBeDefined());
    screen.edit('1.000000000000001-');
    const session = screen.owner()!.session;
    expect(await screen.navigate()).toBe(false);
    expect(screen.owner()?.session).toBe(session);
    expect(session.snapshot.content.edits[0].rawValue).toBe('1.000000000000001-');
    expect(session.snapshot.saveStatus).toBe(status === 409 ? 'conflict' : 'error');
    expect(session.hasUnacknowledged).toBe(true);
    expect(screen.events).toEqual([]);
  });
});

it('external navigation blocks a correction opening before an editor exists and removes it after the response completes', async () => {
  let completeOpen!: (response: Response) => void;
  await withCorrectionScreen(async (_url, init) => {
    const command = init?.body ? JSON.parse(String(init.body)) : null;
    if (command?.action === 'open') return new Promise(resolve => { completeOpen = resolve; });
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.monthAction('새 수정안');
    // The home tab can be clicked in the same event turn, before React renders the busy flag.
    expect(await screen.navigate()).toBe(false);
    expect(screen.owner()).toBeUndefined();
    completeOpen(Response.json({ ok: true, editor: navigationEditor }));
    await vi.waitFor(() => expect(screen.owner()).toBeDefined());
    expect(await screen.navigate()).toBe(true);
    expect(screen.owner()).toBeUndefined();
  });
});

it('a preview started while external navigation drains a save keeps its editor until the new async work finishes', async () => {
  let acknowledge!: (response: Response) => void;
  let completePreview!: (response: Response) => void;
  let saved: { content: typeof navigationDraft.content } | undefined;
  await withCorrectionScreen(async (_url, init) => {
    const command = init?.body ? JSON.parse(String(init.body)) : null;
    if (command?.action === 'open') return Response.json({ ok: true, editor: navigationEditor });
    if (command?.action === 'create') { saved = command; return new Promise(resolve => { acknowledge = resolve; }); }
    if (command?.action === 'preview') return new Promise(resolve => { completePreview = resolve; });
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.monthAction('새 수정안');
    await vi.waitFor(() => expect(screen.owner()).toBeDefined());
    screen.edit('0');
    const session = screen.owner()!.session;
    const leave = screen.navigate();
    await vi.waitFor(() => expect(saved).toBeDefined());
    screen.editorAction('변경 내용 확인');
    acknowledge(Response.json({ ok: true, draft: { ...navigationDraft, content: saved!.content } }));
    expect(await leave).toBe(false);
    await vi.waitFor(() => expect(session.snapshot.busy).toBe(true));
    expect(screen.owner()?.session).toBe(session);
    expect(await screen.navigate()).toBe(false);
    completePreview(Response.json({ ok: true, result: { kind: 'no-change' } }));
    await vi.waitFor(() => expect(session.snapshot.busy).toBe(false));
    expect(await screen.navigate()).toBe(true);
    expect(screen.owner()).toBeUndefined();
  });
});

it('an unacknowledged copy command blocks external navigation without an editor and can retry its same key', async () => {
  const copyKeys: string[] = [];
  let completeCopy!: (response: Response) => void;
  await withCorrectionScreen(async (_url, init) => {
    const command = init?.body ? JSON.parse(String(init.body)) : null;
    if (command?.action === 'copy') {
      copyKeys.push(command.idempotencyKey);
      if (copyKeys.length === 1) throw new TypeError('Copy ACK lost');
      return new Promise(resolve => { completeCopy = resolve; });
    }
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.workAction('onCopy');
    await vi.waitFor(() => expect(screen.render().some(node => node.props.title === '수정안 안내')).toBe(true));
    expect(screen.owner()).toBeUndefined();
    expect(await screen.navigate()).toBe(false);
    screen.workAction('onCopy');
    expect(copyKeys).toHaveLength(2);
    expect(copyKeys[1]).toBe(copyKeys[0]);
    expect(await screen.navigate()).toBe(false);
    completeCopy(Response.json({ ok: true, result: navigationDraft }));
    await vi.waitFor(() => expect(screen.owner()).toBeDefined());
    expect(await screen.navigate()).toBe(true);
    expect(screen.owner()).toBeUndefined();
  });
});

it('external navigation closes a readonly correction detail and exposes the past-entry action without restoring focus', async () => {
  await withCorrectionScreen(async url => url.includes('refKind=') ? Response.json({ ok: true, detail }) : Response.json({ ok: true, items: [navigationMonth], nextCursor: null }), async screen => {
    screen.workAction('onView');
    await vi.waitFor(() => expect(screen.render().some(node => node.props.children === '수정안 내용 보기')).toBe(true));
    expect(await screen.navigate()).toBe(true);
    const tree = screen.render();
    expect(tree.some(node => node.props.children === '수정안 내용 보기')).toBe(false);
    const pastEntry = tree.find(node => node.props.label === '과거 자료 등록');
    expect(pastEntry).toBeDefined();
    (pastEntry!.props.onClick as (event: unknown) => void)({ currentTarget: {} });
    expect(screen.events).toEqual(['past-entry']);
  });
});

const navigationComparison = { previewId: 'preview', previewHash: 'hash', draftRevision: 1, baseRevision: 1, rawDiff: [], resultDiff: [], affectedReports: [] };
const navigationPendingDetail = { ...detail, summary: { ...summary, state: 'pending', capabilities: { ...summary.capabilities, resume: true } }, preview: navigationComparison };

it('a successful legacy confirmation releases its mutation and action lock before handing the confirmed report to the parent', async () => {
  let confirmAck!: (response: Response) => void;
  await withCorrectionScreen(async (url, init) => {
    if (url === '/api/report-history/corrections' && init?.body) return new Promise(resolve => { confirmAck = resolve; });
    if (url.includes('refKind=')) return Response.json({ ok: true, detail: { ...navigationPendingDetail, summary: { ...navigationPendingDetail.summary, ref: { kind: 'legacy-preview', id: 'legacy' } } } });
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.workAction('onView');
    await vi.waitFor(() => expect(screen.render().some(node => node.props.label === '정정 확정')).toBe(true));
    const confirm = screen.render().find(node => node.props.label === '정정 확정')!;
    (confirm.props.onClick as () => void)();
    expect(await screen.navigate()).toBe(false);
    confirmAck(Response.json({ ok: true, result: { kind: 'confirmed', confirmationId: 'confirmed', revision: 2 } }));
    await vi.waitFor(() => expect(screen.events).toEqual(['confirmed']));
    expect(await screen.handoffs[0]).toBe(true);
    expect(screen.render().some(node => node.props.children === '수정안 내용 보기')).toBe(false);
  });
});

it('an unknown session confirmation keeps its owner and request key until a confirmed retry can hand off', async () => {
  const keys: string[] = [];
  let retryAck!: (response: Response) => void;
  await withCorrectionScreen(async (url, init) => {
    const command = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.includes('draftId=')) return Response.json({ ok: true, draft: navigationDraft });
    if (url.includes('refKind=')) return Response.json({ ok: true, detail: navigationPendingDetail });
    if (command?.action === 'preview') return Response.json({ ok: true, result: { kind: 'preview', previewId: 'preview', previewHash: 'hash', draftRevision: 1 } });
    if (url === '/api/report-history/corrections') {
      keys.push(command.idempotencyKey);
      if (keys.length === 1) throw new TypeError('Confirmation ACK lost');
      return new Promise(resolve => { retryAck = resolve; });
    }
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.monthAction('이어서 작성');
    await vi.waitFor(() => expect(screen.owner()).toBeDefined());
    const session = screen.owner()!.session;
    screen.editorAction('변경 내용 확인');
    await vi.waitFor(() => expect(session.canConfirm).toBe(true));
    screen.editorAction('정정 확정');
    await vi.waitFor(() => expect(session.snapshot.busy).toBe(false));
    expect(session.snapshot.message).toContain('같은 요청으로 다시 시도');
    expect(await screen.navigate()).toBe(false);
    expect(screen.owner()?.session).toBe(session);
    const controls = screen.editorControls();
    expect(controls.find(node => node.props.label === '전체 정정 사유')?.props.isReadOnly).toBe(true);
    expect(controls.find(node => node.props.label === '변경 내용 확인')?.props.isDisabled).toBe(true);
    expect(controls.find(node => node.props.label === '목록으로')?.props.isDisabled).toBe(true);
    expect(controls.find(node => node.props.label === '정정 확정')?.props.isDisabled).toBe(false);
    screen.editorAction('정정 확정');
    await vi.waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    expect(await screen.navigate()).toBe(false);
    retryAck(Response.json({ ok: true, result: { kind: 'already-confirmed', confirmationId: 'confirmed', revision: 2 } }));
    await vi.waitFor(() => expect(screen.events).toEqual(['confirmed']));
    expect(await screen.handoffs[0]).toBe(true);
    expect(screen.owner()).toBeUndefined();
  });
});

it.each([404, 409, 422])('a definite copy rejection %i releases navigation without claiming a successful copy', async status => {
  await withCorrectionScreen(async (_url, init) => {
    const command = init?.body ? JSON.parse(String(init.body)) : null;
    if (command?.action === 'copy') return Response.json({ ok: false, code: status === 409 ? 'HEAD_CHANGED' : 'INVALID_DRAFT' }, { status });
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.workAction('onCopy');
    await vi.waitFor(() => expect(screen.render().some(node => node.props.title === '수정안 안내')).toBe(true));
    expect(screen.owner()).toBeUndefined();
    expect(await screen.navigate()).toBe(true);
    expect(screen.events).toEqual([]);
  });
});

it.each([408, 429, 503])('an uncertain copy response %i keeps its command until the same key succeeds', async status => {
  const keys: string[] = [];
  await withCorrectionScreen(async (_url, init) => {
    const command = init?.body ? JSON.parse(String(init.body)) : null;
    if (command?.action === 'copy') {
      keys.push(command.idempotencyKey);
      return keys.length === 1 ? Response.json({ ok: false, code: 'RETRY_REQUIRED' }, { status }) : Response.json({ ok: true, result: { kind: 'no-change' } });
    }
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.workAction('onCopy');
    await vi.waitFor(() => expect(screen.render().some(node => node.props.title === '수정안 안내')).toBe(true));
    expect(await screen.navigate()).toBe(false);
    screen.workAction('onCopy');
    await vi.waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    await vi.waitFor(() => expect(screen.render().some(node => String(node.props.description).includes('이미 같은 값'))).toBe(true));
    expect(await screen.navigate()).toBe(true);
  });
});

it.each([409, 422])('a definite reapply rejection %i preserves its proposal and releases external navigation', async status => {
  await withCorrectionScreen(async (url, init) => {
    const command = init?.body ? JSON.parse(String(init.body)) : null;
    if (command?.action === 'copy') return Response.json({ ok: true, result: { ...navigationDraft, requiresReapply: true } });
    if (command?.action === 'open') return Response.json({ ok: true, editor: navigationEditor });
    if (command?.action === 'reapply') return Response.json({ ok: false, code: 'INVALID_DRAFT' }, { status });
    if (url.includes('refKind=')) return Response.json({ ok: true, detail });
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.workAction('onCopy');
    await vi.waitFor(() => expect(screen.owner()).toBeDefined());
    const session = screen.owner()!.session;
    screen.owner()!.onRefreshComparison!();
    await vi.waitFor(() => expect(screen.owner()!.comparison).not.toBeNull());
    screen.owner()!.onReapply!();
    await vi.waitFor(() => expect(screen.render().some(node => node.props.title === '수정안 안내')).toBe(true));
    expect(screen.owner()?.session).toBe(session);
    expect(session.snapshot.draft?.requiresReapply).toBe(true);
    expect(await screen.navigate()).toBe(true);
  });
});

it.each([0, 408, 429, 503])('a settled unknown close response %i can dismiss its dialog while preserving the original request for banner recovery', async status => {
  const keys: string[] = [];
  await withCorrectionScreen(async (url, init) => {
    const command = init?.body ? JSON.parse(String(init.body)) : null;
    if (command?.action === 'close') {
      keys.push(command.idempotencyKey);
      if (keys.length === 1) {
        if (!status) throw new TypeError('Close ACK lost');
        return Response.json({ ok: false, code: 'RETRY_REQUIRED' }, { status });
      }
      return Response.json({ ok: true, result: summary });
    }
    if (url.includes('refKind=')) return Response.json({ ok: true, detail });
    if (url.includes('draftId=')) return Response.json({ ok: true, draft: navigationDraft });
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.workAction('onClose');
    const dialog = () => screen.render().find(node => node.props.title === '검토를 종료할까요?')!;
    await vi.waitFor(() => expect(dialog().props.isOpen).toBe(true));
    (dialog().props.onAction as () => void)();
    (dialog().props.onOpenChange as (open: boolean) => void)(false);
    expect(dialog().props.isOpen).toBe(true);
    await vi.waitFor(() => expect(screen.render().some(node => node.props.title === '수정안 안내')).toBe(true));
    expect(await screen.navigate()).toBe(false);
    expect(dialog().props.actionLabel).toBe('같은 요청으로 결과 확인');
    expect(dialog().props.description).toContain('종료 결과를 확인하지 못했습니다');
    (dialog().props.onOpenChange as (open: boolean) => void)(false);
    expect(dialog().props.isOpen).toBe(false);
    expect(await screen.navigate()).toBe(false);
    const retry = screen.render().find(node => node.props.label === '같은 요청으로 결과 확인');
    expect(retry).toBeDefined();
    (retry!.props.onClick as () => void)();
    await vi.waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    await vi.waitFor(() => expect(dialog().props.isOpen).toBe(false));
    await vi.waitFor(() => expect(screen.render().some(node => node.props.label === '같은 요청으로 결과 확인')).toBe(false));
    expect(await screen.navigate()).toBe(true);
  });
});

it.each([409, 422])('a definite close rejection %i allows cancellation and navigation without closing the work', async status => {
  await withCorrectionScreen(async (url, init) => {
    const command = init?.body ? JSON.parse(String(init.body)) : null;
    if (command?.action === 'close') return Response.json({ ok: false, code: 'INVALID_DRAFT' }, { status });
    if (url.includes('refKind=')) return Response.json({ ok: true, detail });
    if (url.includes('draftId=')) return Response.json({ ok: true, draft: navigationDraft });
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.workAction('onClose');
    const dialog = () => screen.render().find(node => node.props.title === '검토를 종료할까요?')!;
    await vi.waitFor(() => expect(dialog().props.isOpen).toBe(true));
    (dialog().props.onAction as () => void)();
    await vi.waitFor(() => expect(screen.render().some(node => node.props.title === '수정안 안내')).toBe(true));
    expect(dialog().props.actionLabel).toBe('검토 종료');
    (dialog().props.onOpenChange as (open: boolean) => void)(false);
    expect(dialog().props.isOpen).toBe(false);
    expect(await screen.navigate()).toBe(true);
    expect(screen.events).toEqual([]);
  });
});

it('a close action cannot replace an unknown copy command before its original request resolves', async () => {
  const keys: string[] = [];
  await withCorrectionScreen(async (_url, init) => {
    const command = init?.body ? JSON.parse(String(init.body)) : null;
    if (command?.action === 'copy') {
      keys.push(command.idempotencyKey);
      if (keys.length === 1) throw new TypeError('Copy ACK lost');
      return Response.json({ ok: true, result: { kind: 'no-change' } });
    }
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.workAction('onCopy');
    await vi.waitFor(() => expect(screen.render().some(node => node.props.title === '수정안 안내')).toBe(true));
    screen.workAction('onClose');
    await vi.waitFor(() => expect(screen.render().find(node => node.props.title === '검토를 종료할까요?')?.props.isOpen).toBe(false));
    expect(await screen.navigate()).toBe(false);
    screen.workAction('onCopy');
    await vi.waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    await vi.waitFor(() => expect(screen.render().some(node => String(node.props.description).includes('이미 같은 값'))).toBe(true));
    expect(await screen.navigate()).toBe(true);
  });
});

it('an unknown legacy confirmation can resolve its original command after the detail has closed', async () => {
  const keys: string[] = [];
  await withCorrectionScreen(async (url, init) => {
    const command = init?.body ? JSON.parse(String(init.body)) : null;
    if (url === '/api/report-history/corrections') {
      keys.push(command.idempotencyKey);
      if (keys.length === 1) throw new TypeError('Confirmation ACK lost');
      return Response.json({ ok: true, result: { kind: 'already-confirmed', confirmationId: 'confirmed', revision: 2 } });
    }
    if (url.includes('refKind=')) return Response.json({ ok: true, detail: { ...navigationPendingDetail, summary: { ...navigationPendingDetail.summary, ref: { kind: 'legacy-preview', id: 'legacy' } } } });
    return Response.json({ ok: true, items: [navigationMonth], nextCursor: null });
  }, async screen => {
    screen.workAction('onView');
    await vi.waitFor(() => expect(screen.render().some(node => node.props.label === '정정 확정')).toBe(true));
    (screen.render().find(node => node.props.label === '정정 확정')!.props.onClick as () => void)();
    await vi.waitFor(() => expect(screen.render().some(node => node.props.title === '수정안 안내')).toBe(true));
    (screen.render().find(node => node.props.label === '내용 닫기')!.props.onClick as () => void)();
    expect(screen.render().some(node => node.props.children === '수정안 내용 보기')).toBe(false);
    expect(await screen.navigate()).toBe(false);
    const retry = screen.render().find(node => node.props.label === '같은 요청으로 결과 확인');
    expect(retry).toBeDefined();
    (retry!.props.onClick as () => void)();
    await vi.waitFor(() => expect(screen.events).toContain('confirmed'));
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(await screen.handoffs[0]).toBe(true);
  });
});
