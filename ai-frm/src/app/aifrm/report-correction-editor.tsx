'use client';

import { CorrectionPreviewDetails } from './report-history-controls';
import { Activity, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutHeader, LayoutFooter } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Table, pixel, proportional, useTableRowExpansion, useTableStickyColumns, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import type { CorrectionEditorRow, CorrectionMonthSummary, CorrectionReviewDetail, CorrectionWorkRef, CorrectionWorkSummary } from '@/domain/report-history/correction';
import { addMonths, parseYearMonth } from '@/domain/shared/year-month';
import { WORK_LABEL, emptyFilters, filterEditorRows, mergePage, monthRange, originalValue, primaryMonthAction, proposalValue, updateDraftEdit, workKey, type EditorFilter } from './report-correction-state';
import { CorrectionSession, correctionErrorMessage, createCorrectionClient, useReportCorrection, type CorrectionClient, CorrectionClientError } from './use-report-correction';
type Confirmation = {
  confirmationId: string;
  reportCycle: string;
  revision: number;
  confirmedAt: string;
};
const categoryLabel = { cashflow: '자금자료', economic: '경제지표', funding: '조달금리' };
const dateText = (date: string) => { const value = new Date(date); return Number.isNaN(value.getTime()) ? date : value.toLocaleString('ko-KR'); };
const identity = (row: CorrectionEditorRow) => `${row.label} · 자료 ${row.sourceRound} · ${row.period} · ${row.unit}`;
type WorkRow = CorrectionWorkSummary & Record<string, unknown>;
export function CorrectionWorkTable({ items, onView, onResume, onClose, onCopy }: {
  items: readonly CorrectionWorkSummary[];
  onView: (ref: CorrectionWorkRef, trigger?: HTMLElement) => void;
  onResume: (ref: CorrectionWorkRef, trigger?: HTMLElement) => void;
  onClose: (ref: CorrectionWorkRef) => void;
  onCopy: (ref: CorrectionWorkRef) => void;
}) {
  const sticky = useTableStickyColumns<WorkRow>({ startKeys: ['summary'] });
  const columns: TableColumn<WorkRow>[] = [
    { key: 'summary', header: '수정안', width: pixel(290), renderCell: row => <VStack gap={1}><Text>{row.summary}</Text><Text color="secondary">{row.reportTitleMonth} 보고서 · 기준 {row.baseRevision}차 · {row.validChangeCount === null ? `미검증 입력 ${row.inputCount}개` : `검증된 변경 ${row.validChangeCount}개`}</Text></VStack> },
    { key: 'state', header: '상태', width: pixel(120), renderCell: row => <Token label={WORK_LABEL[row.state]} size="sm" color={row.state === 'pending' ? 'blue' : row.state === 'stale' ? 'yellow' : 'gray'}/> },
    { key: 'savedAt', header: '수정 시각', width: pixel(180), renderCell: row => <Text>{dateText(row.savedAt)}</Text> },
    { key: 'actions', header: '동작', width: proportional(1), renderCell: row => <HStack gap={1} wrap="wrap"><Button size="sm" variant="ghost" label="내용 보기" aria-label={`${row.summary} 내용 보기`} onClick={event => onView(row.ref, event.currentTarget)}/>{row.capabilities.resume && <Button size="sm" variant="secondary" label="이어서 작성" onClick={event => onResume(row.ref, event.currentTarget)}/>}{row.capabilities.close && <Button size="sm" variant="ghost" label="검토 종료" onClick={() => onClose(row.ref)}/>}{row.capabilities.copy && <Button size="sm" variant="secondary" label="새 수정안으로 다시 검토" onClick={() => onCopy(row.ref)}/>}</HStack> },
  ];
  return <Table data={items.map(row => ({ ...row }))} columns={columns} idKey={row => workKey(row.ref)} density="compact" plugins={{ sticky }}/>;
}
export function CorrectionReviewDetails({ detail, comparison = false }: {
  detail: CorrectionReviewDetail;
  comparison?: boolean;
}) {
  const data = detail.rows.map(row => ({ ...row, identity: identity(row), before: originalValue(row), proposal: proposalValue(row.proposedAction, row.proposedText), latest: row.current ? originalValue(row.current) : '비교 불가' }));
  const sticky = useTableStickyColumns<(typeof data)[number]>({ startKeys: ['identity'] });
  return <VStack gap={3} aria-label="수정안 내용"><Text>{detail.summary.reportTitleMonth} 보고서 · {WORK_LABEL[detail.summary.state]} · 기준 {detail.summary.baseRevision}차</Text>
  <Table data={data} idKey="rowId" density="compact" plugins={{ sticky }} columns={[
      { key: 'identity', header: '항목·자료회차·적용 월/평가일·단위', width: pixel(270) },
      { key: 'before', header: '시작값', width: pixel(170) },
      ...(comparison ? [{ key: 'latest', header: '최신값', width: pixel(170) }] : []),
      { key: 'proposal', header: '제안값', width: pixel(180) },
      { key: 'evidenceNote', header: '행별 근거', width: proportional(1) },
    ]}/>
  <Text>사유 · {detail.reason || '입력 전'}</Text><Text>근거 · {detail.evidenceNote || '없음'}</Text>
  {detail.preview && <CorrectionPreviewDetails preview={detail.preview}/>}
  {detail.resolvedAt && <Text color="secondary">처리 시각 · {dateText(detail.resolvedAt)}</Text>}
 </VStack>;
}
function CorrectionProposalDetails({ editor, content }: {
  editor: import('@/domain/report-history/correction').CorrectionEditorDto;
  content: import('@/domain/report-history/correction').DraftContent;
}) {
  const data = content.edits.map(edit => { const row = editor.rows.find(row => row.rowId === edit.rowId); return { rowId: edit.rowId, item: row ? identity(row) : '이전 기준의 항목', before: row ? originalValue(row) : '확인 불가', proposal: proposalValue(edit.action, edit.rawValue) }; });
  return <VStack gap={2}><Text>{editor.basis.reportTitleMonth} 보고서 · 기준 {editor.baseRevision}차</Text><Table data={data} idKey="rowId" density="compact" columns={[{ key: 'item', header: '항목·자료회차·기간·단위', width: pixel(270) }, { key: 'before', header: '시작값', width: proportional(1) }, { key: 'proposal', header: '내 입력', width: proportional(1) }]}/><Text>사유 · {content.reason || '입력 전'}</Text><Text>근거 · {content.evidenceNote || '없음'}</Text></VStack>;
}
function CorrectionBasisDetails({ editor }: {
  editor: import('@/domain/report-history/correction').CorrectionEditorDto;
}) {
  return <VStack gap={2}><Text>{editor.basis.reportTitleMonth} 보고서 · 최신 {editor.baseRevision}차</Text><Table data={editor.rows.map(row => ({ ...row, item: identity(row), value: originalValue(row) }))} idKey="rowId" density="compact" columns={[{ key: 'item', header: '항목·자료회차·기간·단위', width: pixel(270) }, { key: 'value', header: '최신 확정값', width: proportional(1) }]}/></VStack>;
}
export function CorrectionEditor({ session, onLeave, onConfirmed, comparison, onRefreshComparison, onReapply }: {
  session: CorrectionSession;
  onLeave: () => void;
  onConfirmed: (id: string) => void;
  comparison?: {
    detail: CorrectionReviewDetail;
    confirmationId: string;
    revision: number;
  } | null;
  onRefreshComparison?: () => void;
  onReapply?: () => void;
}) {
  const state = useReportCorrection(session);
  const compact = useMediaQuery('(max-width: 800px)');
  const [acceptLatestOpen, setAcceptLatestOpen] = useState(false);
  const [category, setCategory] = useState<CorrectionEditorRow['category']>('cashflow');
  const [filters, setFilters] = useState<Record<CorrectionEditorRow['category'], EditorFilter>>({ cashflow: emptyFilters(), economic: emptyFilters(), funding: emptyFilters() });
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const currentFilter = filters[category];
  const rows = filterEditorRows(state.editor.rows, category, currentFilter, state.content).map(row => ({ ...row }));
  const sticky = useTableStickyColumns<(typeof rows)[number]>({ startKeys: ['label'] });
  const changeFilter = (patch: Partial<EditorFilter>) => setFilters(previous => ({ ...previous, [category]: { ...previous[category], ...patch } }));
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); headingRef.current?.scrollIntoView({ block: 'start' }); }, [session]);
  useEffect(() => {
    const error = state.errors[0];
    if (!error)
      return;
    if (error.rowId) {
      const row = state.editor.rows.find(row => row.rowId === error.rowId);
      if (row) {
        queueMicrotask(() => { setCategory(row.category); setFilters(previous => ({ ...previous, [row.category]: emptyFilters() })); requestAnimationFrame(() => inputRefs.current.get(row.rowId)?.focus()); });
      }
    }
    else if (error.field === 'reason')
      reasonRef.current?.focus();
    else if (error.field === 'evidenceNote')
      noteRef.current?.focus();
    else
      headingRef.current?.focus();
  }, [state.errors, state.editor.rows]);
  const columns: TableColumn<(typeof rows)[number]>[] = [
    { key: 'label', header: '항목·자료', width: pixel(compact ? 190 : 250), renderCell: row => <VStack gap={1}><Text weight="medium">{row.label}</Text><Text color="secondary">자료 {row.sourceRound} · {row.period} · {row.unit}</Text></VStack> },
    { key: 'originalText', header: '시작값', width: pixel(180), renderCell: row => <Text>{originalValue(row)}</Text> },
    { key: 'value', header: '수정 값', width: pixel(240), renderCell: row => {
        const edit = state.content.edits.find(edit => edit.rowId === row.rowId), error = state.errors.find(error => error.rowId === row.rowId);
        return <VStack gap={2}>
   <TextInput ref={input => {
            if (input)
              inputRefs.current.set(row.rowId, input);
            else
              inputRefs.current.delete(row.rowId);
          }} label={`${identity(row)} 수정 값`} isLabelHidden value={edit?.action === 'set' ? edit.rawValue ?? '' : ''} onChange={value => session.change(updateDraftEdit(state.content, row.rowId, value))} type="text" size="sm" placeholder="빈칸은 변경 없음" isDisabled={!row.allowedActions.includes('set') || edit?.action === 'set-missing' || state.busy || state.completed || state.draft?.requiresReapply} status={error ? { type: 'error', message: error.message } : undefined}/>
   {row.allowedActions.includes('set-missing') && <CheckboxInput size="sm" label={`${row.label} ${row.period} 값 없음`} value={edit?.action === 'set-missing'} isDisabled={state.busy || state.completed || state.draft?.requiresReapply} onChange={checked => session.change(updateDraftEdit(state.content, row.rowId, checked ? null : ''))}/>}
  </VStack>;
      } },
  ];
  const saveLabel = { idle: '입력 전', saving: '저장 중', saved: '보관됨', error: '저장 실패', conflict: '충돌 · 비교 필요' }[state.saveStatus];
  const safePreview = async () => {
    try {
      await session.preview();
    }
    catch { /* the queue keeps the error and raw inputs */ }
  };
  const leave = async () => {
    try {
      await session.drain();
      onLeave();
    }
    catch { /* remain in the editor */ }
  };
  return <VStack className="report-controls" as="section" gap={3} aria-label="원자료 수정">
  <Layout height="auto" defaultHasDividers header={<LayoutHeader><VStack gap={2}><Heading level={3} tabIndex={-1} ref={headingRef}>{state.editor.basis.reportTitleMonth} 보고서 원자료 수정</Heading><HStack gap={2} wrap="wrap"><Text>자료회차 {state.editor.basis.reportCycle} · 기준 {state.editor.baseRevision}차</Text><Token label={saveLabel} color={state.saveStatus === 'error' ? 'red' : state.saveStatus === 'saved' ? 'green' : 'gray'} size="sm"/><Text role="status" aria-live="polite">{state.message}</Text></HStack></VStack></LayoutHeader>} content={<LayoutContent isScrollable={false}><VStack gap={3}>
  {state.conflict && <VStack gap={3}><Banner status="warning" title="저장 충돌 · 내 입력을 유지하고 있습니다" description="최신 내용을 조회해 비교한 뒤 전환 여부를 선택해 주세요."/><Heading level={4}>내 미보관 입력</Heading><CorrectionProposalDetails editor={state.editor} content={state.content}/>{state.conflict.latest && <VStack gap={2}><Heading level={4}>서버의 최신 내용</Heading>{state.conflict.latest.detail ? <CorrectionReviewDetails detail={state.conflict.latest.detail}/> : <CorrectionBasisDetails editor={state.conflict.latest.editor}/>}</VStack>}</VStack>}
  {state.draft?.requiresReapply && !state.completed ? <VStack gap={3}><Banner status="warning" title="제안을 최신 확정본과 비교해 주세요" description="비교한 값을 확인하고 재적용한 뒤 변경 내용을 검증합니다."/>{comparison && <><Text>비교한 최신 확정본 · {comparison.revision}차</Text><CorrectionReviewDetails detail={comparison.detail} comparison/></>}<HStack gap={2} wrap="wrap"><Button label="최신값 다시 비교" variant="secondary" onClick={onRefreshComparison}/><Button label="제안값 재적용" isDisabled={!comparison} onClick={onReapply}/></HStack></VStack> : <>
  <TabList value={category} onChange={value => setCategory(value as typeof category)} role="tablist" size="sm" hasDivider>{Object.entries(categoryLabel).map(([value, label]) => <Tab key={value} value={value} label={label} panelId={`correction-${value}`}/>)}</TabList>
  <VStack id={`correction-${category}`} role="tabpanel" aria-label={categoryLabel[category]} gap={3}>
   <HStack gap={2} wrap="wrap" align="end">
  <Selector label="자료회차" size="sm" value={currentFilter.round} options={[{ value: 'all', label: '모든 자료회차' }, ...Array.from(new Set(state.editor.rows.filter(row => row.category === category).map(row => row.sourceRound))).map(value => ({ value, label: value }))]} onChange={round => changeFilter({ round })}/>
  <Selector label="적용 월·평가일" size="sm" value={currentFilter.period} options={[{ value: 'all', label: '모든 월·평가일' }, ...Array.from(new Set(state.editor.rows.filter(row => row.category === category).map(row => row.period))).sort().map(value => ({ value, label: value }))]} onChange={period => changeFilter({ period })}/>
  <TextInput label="항목 검색" size="sm" value={currentFilter.query} onChange={query => changeFilter({ query })} hasClear/>
  <CheckboxInput label="입력한 항목만" size="sm" value={currentFilter.changedOnly} onChange={changedOnly => changeFilter({ changedOnly })}/>
   </HStack>
   <Table data={rows} idKey="rowId" columns={columns} plugins={{ sticky }} density="compact"/>
  </VStack>
  <Text color="secondary">빈 수정 칸은 변경 없음 · 0과 값 없음은 구분합니다.</Text>
  <TextArea ref={reasonRef} label="전체 정정 사유" value={state.content.reason} onChange={reason => session.change({ ...state.content, reason })} maxLength={2000} isRequired isReadOnly={state.busy || state.completed} status={state.errors.find(error => error.field === 'reason') ? { type: 'error', message: state.errors.find(error => error.field === 'reason')!.message } : undefined}/>
  <TextArea ref={noteRef} label="근거 메모" value={state.content.evidenceNote} onChange={evidenceNote => session.change({ ...state.content, evidenceNote })} maxLength={2000} isOptional isReadOnly={state.busy || state.completed} status={state.errors.find(error => error.field === 'evidenceNote') ? { type: 'error', message: state.errors.find(error => error.field === 'evidenceNote')!.message } : undefined}/>
  {state.preview && state.comparison && <CorrectionPreviewDetails preview={state.comparison} confirmation={{ kind: 'unconfirmed' }}/>}
  {state.errors.length > 0 && <Banner status="error" title="입력을 확인해 주세요" description={state.errors.map(error => error.message).join(' ')}/>}
  </>}
   </VStack></LayoutContent>} footer={<LayoutFooter><HStack gap={2} wrap="wrap"><Button label="목록으로" variant="ghost" isDisabled={state.busy} onClick={() => void leave()}/>{state.conflict && <><Button label="최신 내용 조회·비교" variant="secondary" isDisabled={state.busy} onClick={() => void session.readConflictLatest().catch(() => { })}/><Button label="서버의 최신 내용으로 전환" variant="secondary" isDisabled={!state.conflict.latest || state.busy} onClick={() => setAcceptLatestOpen(true)}/></>}{state.saveStatus === 'error' && <Button label="저장 다시 시도" variant="secondary" onClick={() => void session.retry().catch(() => { })}/>}{!state.draft?.requiresReapply && <><Button label="변경 내용 확인" variant="secondary" isDisabled={state.busy || state.completed || state.stale || !!state.conflict || state.saveStatus === 'error'} onClick={() => void safePreview()}/><Button label="정정 확정" isDisabled={!session.canConfirm} isLoading={state.busy} onClick={() => void session.confirm().then(result => {
          if (result)
            onConfirmed(result.confirmationId);
        }).catch(() => { })}/></>}</HStack></LayoutFooter>}/>
  <AlertDialog isOpen={acceptLatestOpen} onOpenChange={setAcceptLatestOpen} title="서버의 최신 내용으로 전환할까요?" description="화면에서 비교한 서버의 최신 내용을 엽니다. 내 미보관 입력은 버리며 서버에 덮어쓰지 않습니다." actionLabel="미보관 입력 버리고 전환" cancelLabel="내 입력 유지" onAction={() => { session.acceptConflictLatest(); setAcceptLatestOpen(false); }}/>
 </VStack>;
}
function MonthWork({ month, confirmations, client, onView, onResume, onClose, onCopy, onOpen, refreshRevision }: {
  month: CorrectionMonthSummary;
  refreshRevision: number;
  confirmations: readonly Confirmation[];
  client: CorrectionClient;
  onView: (ref: CorrectionWorkRef, trigger?: HTMLElement) => void;
  onResume: (ref: CorrectionWorkRef, trigger?: HTMLElement) => void;
  onClose: (ref: CorrectionWorkRef) => void;
  onCopy: (ref: CorrectionWorkRef) => void;
  onOpen: (id: string) => void;
}) {
  const [items, setItems] = useState<readonly CorrectionWorkSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const savedItems = useRef<readonly CorrectionWorkSummary[]>([]);
  const loadedRevision = useRef(-1);
  const load = useCallback(async (cursor?: string) => {
    setBusy(true);
    setError('');
    try {
      let page = await client.work({ reportCycle: month.reportCycle, pendingOnly: false, ...(cursor ? { cursor } : {}) });
      let next = cursor ? mergePage(savedItems.current, page.items, item => workKey(item.ref)) : [...page.items];
      if (!cursor) {
        const preserveCount = savedItems.current.length;
        while (page.nextCursor && next.length < preserveCount) {
          page = await client.work({ reportCycle: month.reportCycle, pendingOnly: false, cursor: page.nextCursor });
          next = mergePage(next, page.items, item => workKey(item.ref));
        }
      }
      savedItems.current = next;
      setItems(next);
      setCursor(page.nextCursor);
      loadedRevision.current = refreshRevision;
    }
    catch {
      setError('수정안을 조회하지 못했습니다.');
    }
    finally {
      setBusy(false);
    }
  }, [client, month.reportCycle, refreshRevision]);
  useEffect(() => { let live = true; queueMicrotask(() => { if (live && loadedRevision.current !== refreshRevision)
    void load(); }); return () => { live = false; }; }, [load, refreshRevision]);
  const old = confirmations.filter(item => item.reportCycle === month.reportCycle && item.confirmationId !== month.latestConfirmationId);
  return <VStack gap={3} padding={3}><Heading level={4}>{month.reportTitleMonth} 수정안·이전 확정본</Heading><CorrectionWorkTable items={items} onView={onView} onResume={onResume} onClose={onClose} onCopy={onCopy}/><Button label="수정안 다시 조회" size="sm" variant="ghost" isDisabled={busy} onClick={() => void load()}/>{cursor && <Button size="sm" variant="secondary" label="수정안 더 보기" isDisabled={busy} onClick={() => void load(cursor)}/>}{error && <Banner status="error" title={error} endContent={<Button label="수정안 다시 조회" onClick={() => void load()}/>}/>}
  {old.length > 0 && <Collapsible trigger={`이전 확정본 ${old.length}개`}><VStack gap={2}>{old.map(item => <HStack key={item.confirmationId} gap={2} wrap="wrap"><Text>{item.revision}차 · {dateText(item.confirmedAt)}</Text><Button label={`${item.revision}차 확정본 열기`} size="sm" variant="ghost" onClick={() => onOpen(item.confirmationId)}/></HStack>)}</VStack></Collapsible>}
 </VStack>;
}
export function ReportCorrectionControls({ confirmations, onOpen, onConfirmed, refreshRevision = 0, registerNavigationGuard }: {
  confirmations: readonly Confirmation[];
  onOpen: (id: string) => void;
  onConfirmed: (id: string) => void;
  refreshRevision?: number;
  registerNavigationGuard?: (guard: (() => Promise<boolean>) | null) => void;
}) {
  const client = useMemo(() => createCorrectionClient(), []);
  const [months, setMonths] = useState<readonly CorrectionMonthSummary[]>([]);
  const loadedMonths=useRef<readonly CorrectionMonthSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [period, setPeriod] = useState('recent');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [session, setSession] = useState<CorrectionSession | null>(null);
  const [detail, setDetail] = useState<CorrectionReviewDetail | null>(null);
  const [comparison, setComparison] = useState<{
    detail: CorrectionReviewDetail;
    confirmationId: string;
    revision: number;
  } | null>(null);
  const [closing, setClosing] = useState<{
    detail: CorrectionReviewDetail;
    revision: number | null;
    key: string;
  } | null>(null);
  const generation = useRef(0);
  const actionGeneration = useRef(0);
  const [actionBusy, setActionBusy] = useState(false);
  const mutation = useRef<{
    key: string;
    run: () => Promise<void>;
  } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const rememberTrigger = (trigger?: HTMLElement) => { if (trigger)
    returnFocus.current = trigger; };
  const restoreTrigger = () => requestAnimationFrame(() => { const target = returnFocus.current?.isConnected ? returnFocus.current : heading.current; target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'nearest' }); });
  useEffect(() => { if (detail) {
    detailHeading.current?.focus({ preventScroll: true });
    detailHeading.current?.scrollIntoView({ block: 'start' });
  } }, [detail]);
  useEffect(() => {
    registerNavigationGuard?.(session ? async () => {
      try {
        await session.drain();
        return !session.snapshot.busy;
      }
      catch {
        return false;
      }
    } : null);
    return () => registerNavigationGuard?.(null);
  }, [session, registerNavigationGuard]);
  const refresh = () => setEpoch(value => value + 1);
  const load = useCallback(async (more?: string) => {
    const token = ++generation.current;
    setBusy(true);
    setError('');
    try {
      let title = latest;
      if (!title) {
        const first = await client.months({ pendingOnly: false });
        title = first.items[0]?.reportTitleMonth ?? null;
        if (token !== generation.current)
          return;
        setLatest(title);
        if (!title) {
          setMonths([]);
          setCursor(null);
          return;
        }
      }
      const range=monthRange(period,title,pendingOnly);
      let page = await client.months({ pendingOnly, ...range, ...(more ? { cursor: more } : {}) });
      let next=more?mergePage(loadedMonths.current,page.items,item=>item.reportCycle):[...page.items];
      if(!more){const preserveCount=loadedMonths.current.length;while(page.nextCursor&&next.length<preserveCount){page=await client.months({pendingOnly,...range,cursor:page.nextCursor});next=mergePage(next,page.items,item=>item.reportCycle);}}
      if (token !== generation.current) return;
      loadedMonths.current=next;setMonths(next);setCursor(page.nextCursor);
    }
    catch {
      if (token === generation.current)
        setError('확정 이력을 조회하지 못했습니다. 다시 조회해 주세요.');
    }
    finally {
      if (token === generation.current)
        setBusy(false);
    }
  }, [client, latest, period, pendingOnly]);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (live)
        void load();
    });
    return () => { live = false; };
  }, [load, epoch, refreshRevision]);
  const act = async (work: () => Promise<void>) => {
    if (actionBusy)
      return;
    setActionBusy(true);
    setError('');
    try {
      await work();
    }
    catch (error) {
      setError(correctionErrorMessage(error));
    }
    finally {
      setActionBusy(false);
    }
  };
  const view = async (ref: CorrectionWorkRef, trigger?: HTMLElement) => {
    rememberTrigger(trigger);
    const token = ++actionGeneration.current;
    setDetail(null);
    const next = await client.detail(ref);
    if (token === actionGeneration.current)
      setDetail(next);
  };
  const resume = async (ref: CorrectionWorkRef, trigger?: HTMLElement) => {
    rememberTrigger(trigger);
    if (ref.kind !== 'draft') {
      await view(ref);
      return;
    }
    const draft = await client.resume(ref.id);
    const detail = await client.detail(ref);
    const next = new CorrectionSession(draft.editor, draft, client);
    if (detail.summary.state === 'stale' && !draft.requiresReapply)
      next.markStale();
    setComparison(null);
    setDetail(null);
    setSession(next);
  };
  const start = async (month: CorrectionMonthSummary, trigger?: HTMLElement) => { rememberTrigger(trigger); const editor = await client.open(month.latestConfirmationId); setComparison(null); setDetail(null); setSession(new CorrectionSession(editor, null, client)); };
  const prepareClose = async (ref: CorrectionWorkRef) => { const stored = await client.detail(ref); const draft = ref.kind === 'draft' ? await client.resume(ref.id) : null; setClosing({ detail: stored, revision: draft?.draftRevision ?? null, key: crypto.randomUUID() }); };
  const copy = async (ref: CorrectionWorkRef) => {
    const key = `copy:${workKey(ref)}`;
    if (!mutation.current || mutation.current.key !== key) {
      const idempotencyKey = crypto.randomUUID();
      mutation.current = { key, run: async () => {
          const copied = await client.copy(ref, idempotencyKey);
          if ('kind' in copied) {
            setError('이미 같은 값입니다. 새 확정 차수를 만들지 않습니다.');
            return;
          }
          setComparison(null);
          setDetail(null);
          setSession(new CorrectionSession(copied.editor, copied, client));
          refresh();
        } };
    }
    await mutation.current.run();
    mutation.current = null;
  };
  const refreshComparison = async () => {
    if (!session?.snapshot.draft)
      return;
    setComparison(null);
    const reportCycle = session.snapshot.editor.basis.reportCycle;
    const page = await client.months({ pendingOnly: false, fromCycle: reportCycle, toCycle: reportCycle });
    const month = page.items.find(item => item.reportCycle === reportCycle);
    if (!month)
      throw Error('NOT_FOUND');
    // Explicit basis preparation enables the repository's semantic three-way DTO.
    await client.open(month.latestConfirmationId);
    const next = await client.detail({ kind: 'draft', id: session.snapshot.draft.draftId });
    const verify = await client.months({ pendingOnly: false, fromCycle: reportCycle, toCycle: reportCycle });
    if (verify.items[0]?.latestConfirmationId !== month.latestConfirmationId)
      throw Error('HEAD_CHANGED');
    setComparison({ detail: next, confirmationId: month.latestConfirmationId, revision: month.latestRevision });
  };
  const reapply = async () => {
    if (!session?.snapshot.draft || !comparison)
      return;
    const draft = session.snapshot.draft;
    const key = `reapply:${draft.draftId}:${draft.draftRevision}:${comparison.confirmationId}`;
    if (!mutation.current || mutation.current.key !== key) {
      const command = { draftId: draft.draftId, expectedDraftRevision: draft.draftRevision, expectedLatestConfirmationId: comparison.confirmationId, idempotencyKey: crypto.randomUUID() };
      mutation.current = { key, run: async () => {
          try {
            const result = await client.reapply(command);
            if ('kind' in result) {
              setSession(null);
              setError('이미 같은 값입니다. 새 확정 차수를 만들지 않습니다.');
              refresh();
              return;
            }
            setSession(new CorrectionSession(result.editor, result, client));
            setComparison(null);
            refresh();
          }
          catch (error) {
            if (error instanceof Error && 'status' in error && error.status === 409) {
              setComparison(null);
              mutation.current = null;
            }
            throw error;
          }
        } };
    }
    await mutation.current.run();
    mutation.current = null;
  };
  const expansion = useTableRowExpansion<CorrectionMonthSummary & Record<string, unknown>>({ expandedKeys: expanded, getRowKey: month => month.reportCycle, onToggle: key => setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(String(key)))
        next.delete(String(key));
      else
        next.add(String(key));
      return next;
    }), renderExpanded: month => <MonthWork key={month.reportCycle} refreshRevision={epoch} month={month} confirmations={confirmations} client={client} onView={(ref, trigger) => void act(() => view(ref, trigger))} onResume={(ref, trigger) => void act(() => resume(ref, trigger))} onClose={ref => void act(() => prepareClose(ref))} onCopy={ref => void act(() => copy(ref))} onOpen={onOpen}/> });
  const sticky = useTableStickyColumns<CorrectionMonthSummary & Record<string, unknown>>({ startKeys: ['reportTitleMonth'] });
  const years = Array.from(new Set([...(latest ? [latest.slice(0, 4)] : []), ...confirmations.map(item => addMonths(parseYearMonth(item.reportCycle), -1).slice(0, 4))])).sort().reverse();
  const columns: TableColumn<CorrectionMonthSummary & Record<string, unknown>>[] = [
    { key: 'reportTitleMonth', header: '보고월', width: pixel(140), renderCell: month => <VStack gap={1}><Text weight="medium">{month.reportTitleMonth}</Text><Text color="secondary">자료 {month.reportCycle}</Text></VStack> },
    { key: 'latestRevision', header: '최신 확정본', width: pixel(160), renderCell: month => <VStack gap={1}><Text>{month.latestRevision}차</Text><Text color="secondary">{dateText(month.confirmedAt)}</Text></VStack> },
    { key: 'pendingCount', header: '미처리', width: pixel(130), renderCell: month => <Text>{month.pendingCount}건 · 작성 중 {month.draftCount}건</Text> },
    { key: 'actions', header: '동작', width: proportional(1), renderCell: month => { const primary = primaryMonthAction(month); return <HStack gap={1} wrap="wrap"><Button label="확정본 열기" size="sm" variant="ghost" isDisabled={actionBusy} onClick={() => onOpen(month.latestConfirmationId)}/><Button label={primary.label} size="sm" variant="secondary" isDisabled={actionBusy} onClick={event => primary.ref ? void act(() => resume(primary.ref, event.currentTarget)) : setExpanded(previous => new Set([...previous, month.reportCycle]))}/><Button label="새 수정안" size="sm" variant="ghost" isDisabled={actionBusy} onClick={event => void act(() => start(month, event.currentTarget))}/></HStack>; } },
  ];
  return <VStack className="report-controls" gap={3}>
   {session && <VStack gap={3}><CorrectionEditor session={session} comparison={comparison} onRefreshComparison={() => void act(refreshComparison)} onReapply={() => void act(reapply)} onLeave={() => { session.dispose(); setSession(null); setComparison(null); refresh(); restoreTrigger(); }} onConfirmed={id => { setSession(null); setComparison(null); refresh(); onConfirmed(id); }}/>{error && <Banner status="warning" title="수정안 안내" description={error}/>}</VStack>}
   <Activity mode={session ? 'hidden' : 'visible'}><VStack as="section" className="report-controls" aria-label="월별 확정 이력" gap={3}>
  <Heading level={3} tabIndex={-1} ref={heading}>월별 확정 이력</Heading>
  <HStack gap={2} wrap="wrap" align="end"><Selector label="보고 기간" value={period} size="sm" options={[{ value: 'recent', label: '최근 12개월' }, ...years.map(value => ({ value, label: `${value}년` })), { value: 'all', label: '전체 기간' }]} onChange={value => { generation.current++;loadedMonths.current=[]; setMonths([]); setCursor(null); setPeriod(value); setExpanded(new Set()); }} isDisabled={pendingOnly || busy}/><CheckboxInput label="전체 기간 미처리만" size="sm" value={pendingOnly} onChange={value => { generation.current++;loadedMonths.current=[]; setMonths([]); setCursor(null); setPendingOnly(value); setExpanded(new Set()); }}/><Button label="확정 이력 다시 조회" size="sm" variant="ghost" isDisabled={busy} onClick={() => { setLatest(null); refresh(); }}/></HStack>
  {busy && <Text role="status">이력 조회 중</Text>}
  <Table data={months.map(month => ({ ...month }))} idKey="reportCycle" columns={columns} plugins={{ expansion, sticky }} density="compact"/>
  {!busy && months.length === 0 && <Text>{pendingOnly ? '미처리 수정안이 없습니다.' : '선택한 기간의 확정본이 없습니다.'}</Text>}
  {cursor && <Button label="보고월 더 보기" variant="secondary" size="sm" isDisabled={busy} onClick={() => void load(cursor)}/>}
  {error && <Banner status="warning" title="수정안 안내" description={error}/>}
  {detail && <VStack gap={3}><Heading level={4} tabIndex={-1} ref={detailHeading}>수정안 내용 보기</Heading><CorrectionReviewDetails detail={detail}/>{detail.summary.ref.kind === 'legacy-preview' && detail.summary.state === 'pending' && detail.preview && <Button label="정정 확정" variant="secondary" isDisabled={actionBusy} onClick={() => void act(async () => {
          const key = `confirm:${workKey(detail.summary.ref)}`;
          if (!mutation.current || mutation.current.key !== key) {
            const command = { previewId: detail.preview!.previewId, previewHash: detail.preview!.previewHash, expectedBaseRevision: detail.summary.baseRevision, idempotencyKey: crypto.randomUUID(), reason: detail.reason };
            mutation.current = { key, run: async () => {
                try {
                  const result = await client.confirm(command);
                  if (result.kind !== 'confirmed' && result.kind !== 'already-confirmed')
                    throw Error('UNKNOWN_CONFIRMATION');
                  setDetail(null);
                  refresh();
                  onConfirmed(result.confirmationId);
                }
                catch (error) {
                  if (error instanceof CorrectionClientError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
                    mutation.current = null;
                    setDetail({ ...detail, preview: null, summary: { ...detail.summary, state: 'stale' } });
                  }
                  throw error;
                }
              } };
          }
          await mutation.current.run();
          mutation.current = null;
        })}/>}<Button label="내용 닫기" size="sm" variant="ghost" onClick={() => { actionGeneration.current++; setDetail(null); restoreTrigger(); }}/></VStack>}
  <AlertDialog isOpen={closing !== null} onOpenChange={open => {
      if (!open)
        setClosing(null);
    }} title="검토를 종료할까요?" description={closing ? `${closing.detail.summary.summary} · 사유: ${closing.detail.reason || '입력 전'}. 확정본은 바뀌지 않습니다.` : ''} actionLabel="검토 종료" cancelLabel="계속 검토" isActionLoading={actionBusy} onAction={() => void act(async () => {
      if (!closing)
        return;
      await client.close(closing.detail.summary.ref, closing.revision, closing.key);
      setClosing(null);
      setDetail(null);
      refresh();
    })}/>
 </VStack></Activity></VStack>;
}
