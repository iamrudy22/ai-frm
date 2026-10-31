'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutFooter, LayoutHeader } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Table, pixel, proportional } from '@astryxdesign/core/Table';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import type { ItemName } from '@/domain/cashflow/statement';
import type { ManualEntryContentV1, ManualEntryDraftDto, ManualEntryFieldError, ManualEntrySummary } from '@/domain/report-history/manual-entry';
import { addMonths, yearMonth, type YearMonth } from '@/domain/shared/year-month';
import { ManualEntryClientError, ManualEntrySession, createManualEntryClient, manualEntryErrorMessage, loadManualEntryPage, useManualEntry, type ManualEntryClient } from './use-manual-entry';
import { FinancialReportPreview } from './report-preview';
import { useReportHwpxDownload } from './use-report-hwpx-download';
import { ManualEntryPrintHost } from './manual-entry-print-host';
import { DocumentThemeProvider } from '@/app/ThemeProvider';
import type { FinancialReport } from './report-model';
const items:readonly ItemName[]=['기초시재','수입계','수입','분양회수','기타수입','지출'];
type Category='cashflow'|'economic'|'funding';
const categories={cashflow:'자금자료',economic:'경제지표',funding:'조달금리'};
const roles={current:'현재 기준회차 · 필수',previous:'이전 비교회차 · 선택', 'forecast-plan':'계획 비교회차 · 선택'};
const states={editing:'작성 중','review-ready':'검토됨','stale-review':'재검토 필요','month-conflict':'같은 월 확정본 있음'};
const dateText=(v:string)=>new Date(v).toLocaleString('ko-KR');
export function ConfirmedHistoryEmpty({state,onCreate,onReset,onRetry}:{state:'global'|'filtered'|'loading'|'error';onCreate?:(trigger?:HTMLElement)=>void;onReset:()=>void;onRetry:()=>void}){
 if(state==='loading')return <Text role="status">확정 이력 조회 중</Text>;
 if(state==='error')return <Banner status="warning" title="확정 이력을 불러오지 못했습니다" endContent={<Button label="확정 이력 다시 조회" size="sm" variant="secondary" onClick={onRetry}/>}/>;
 return state==='global'?<EmptyState title="아직 확정한 보고서가 없습니다" description="과거에 작성한 자료도 보고월별로 등록할 수 있습니다." actions={onCreate&&<Button label="과거 자료 등록" onClick={event=>onCreate?.(event.currentTarget)}/>}/>:<EmptyState title="선택한 조건의 보고서가 없습니다" description="조회 조건을 초기화해 전체 보고서를 확인하세요." actions={<Button label="조건 초기화" variant="secondary" onClick={onReset}/>}/>;
}
export function ManualEntryPendingTable({items,onResume,resumeRef}:{items:readonly ManualEntrySummary[];onResume:(id:string,trigger:HTMLElement)=>void;resumeRef?:(id:string,node:HTMLButtonElement|null)=>void}){
 return <Table data={items.map(row=>({...row}))} idKey="draftId" density="compact" columns={[
  {key:'reportTitleMonth',header:'보고월',width:proportional(1)}, {key:'reportCycle',header:'자료회차',width:proportional(1)},
  {key:'savedAt',header:'보관 시각',width:proportional(2),renderCell:row=><Text>{dateText(row.savedAt)}</Text>},
  {key:'state',header:'상태',width:proportional(1),renderCell:row=><Token label={states[row.state]} size="sm" color={row.state==='review-ready'?'green':row.state==='editing'?'gray':'yellow'}/>},
  {key:'action',header:'동작',width:proportional(1),renderCell:row=><Button label="이어서 작성" aria-label={`${row.reportTitleMonth} 보고서 이어서 작성`} size="sm" variant="secondary" ref={node=>resumeRef?.(row.draftId,node)} onClick={event=>onResume(row.draftId,event.currentTarget)}/>},
 ]}/>;
}
/** Raw editor only: it never calculates, fills absent values or creates source dates. */
export function ManualEntryFields({draft,content,category,onChange,disabled=false,errors=[],fieldRef,expandedReferences=new Set<string>(),onReferenceOpen,cashSelection,onCashSelection}:{draft:ManualEntryDraftDto;content:ManualEntryContentV1;category:Category;onChange:(content:ManualEntryContentV1)=>void;disabled?:boolean;errors?:readonly ManualEntryFieldError[];fieldRef?:(field:string,node:HTMLInputElement|HTMLTextAreaElement|null)=>void;expandedReferences?:ReadonlySet<string>;onReferenceOpen?:(key:string,open:boolean)=>void;cashSelection?:{round:YearMonth;month:YearMonth};onCashSelection?:(selection:{round:YearMonth;month:YearMonth})=>void}){
 const fieldIdentity={...draft,content};
 const bind=(field:string)=>({ref:(node:HTMLInputElement|HTMLTextAreaElement|null)=>fieldRef?.(field,node),status:status(field)});
 const status=(field:string)=>{const error=errors.find(e=>e.field===field);return error?{type:'error' as const,message:error.message}:undefined;};
 const cash=(round:keyof typeof content.cashflow,change:Partial<ManualEntryContentV1['cashflow'][typeof round]>)=>onChange({...content,cashflow:{...content.cashflow,[round]:{...content.cashflow[round],...change}}});
 if(category==='cashflow'){
  const c=draft.catalog.cashflow.find(value=>value.round===cashSelection?.round)??draft.catalog.cashflow.find(value=>value.isRequired)!;
  const period=c.months.includes(cashSelection?.month as YearMonth)?cashSelection!.month:c.round;
  const raw=content.cashflow[c.round];
  const updateItem=(item:ItemName,patch:Partial<typeof raw.items[ItemName]>)=>cash(c.round,{items:{...raw.items,[item]:{...raw.items[item],...patch}}});
  return <VStack gap={4}>
   <HStack gap={3} wrap="wrap" vAlign="end">
    <Selector label="자료회차" value={c.round} options={[...draft.catalog.cashflow].reverse().map(value=>({value:value.round,label:`${value.round} · ${roles[value.role]}`}))} onChange={value=>onCashSelection?.({round:value as YearMonth,month:value as YearMonth})} isDisabled={disabled}/>
    {!c.isRequired&&<VStack id={manualEntryFieldId(fieldIdentity,`cashflow.${c.round}.enabled`)}><CheckboxInput label={`자료 ${c.round} ${roles[c.role]} 사용`} ref={node=>fieldRef?.(`cashflow.${c.round}.enabled`,node)} value={raw.enabled} onChange={enabled=>cash(c.round,{enabled})} isDisabled={disabled}/></VStack>}
   </HStack>
   {raw.enabled?<>
    <HStack gap={3} wrap="wrap" vAlign="start">
     <VStack id={manualEntryFieldId(fieldIdentity,`cashflow.${c.round}.asOfRaw`)}><DateInput label={`자료 ${c.round} 원자료 기준일`} value={(raw.asOfRaw||undefined) as ComponentProps<typeof DateInput>['value']} onChange={value=>cash(c.round,{asOfRaw:value??''})} placeholder="실제 원자료 기준일" format="system_date" isDisabled={disabled} {...bind(`cashflow.${c.round}.asOfRaw`)}/></VStack>
     <Selector label="입력 대상월" value={period} options={c.months.map(month=>({value:month,label:month}))} onChange={value=>onCashSelection?.({round:c.round,month:value as YearMonth})} isDisabled={disabled}/>
    </HStack>
    <Text color="secondary">억원 · 입력 대상월을 바꾸며 원값을 입력합니다. 수입계도 원자료 값을 그대로 입력하세요.</Text>
    <Table data={items.map(item=>({item}))} idKey="item" density="compact" columns={[
     {key:'item',header:'항목·자료 없음',width:proportional(1),renderCell:row=><VStack id={manualEntryFieldId(fieldIdentity,`cashflow.${c.round}.items.${row.item}.mode`)} gap={2}><Text weight="medium">{row.item}</Text><CheckboxInput size="sm" label={`${row.item} 자료 ${c.round} 항목 전체 자료 없음`} ref={node=>fieldRef?.(`cashflow.${c.round}.items.${row.item}.mode`,node)} value={raw.items[row.item].mode==='unavailable'} onChange={checked=>updateItem(row.item,{mode:checked?'unavailable':'values'})} isDisabled={disabled}/>{raw.items[row.item].mode==='unavailable'&&<VStack id={manualEntryFieldId(fieldIdentity,`cashflow.${c.round}.items.${row.item}.unavailableReason`)}><TextInput size="sm" label={`${row.item} 자료 ${c.round} 자료 없음 사유`} value={raw.items[row.item].unavailableReason} onChange={unavailableReason=>updateItem(row.item,{unavailableReason})} isDisabled={disabled} {...bind(`cashflow.${c.round}.items.${row.item}.unavailableReason`)}/></VStack>}</VStack>},
     {key:period,header:`${period} 원값 · 억원`,width:proportional(1),renderCell:row=><VStack id={manualEntryFieldId(fieldIdentity,`cashflow.${c.round}.items.${row.item}.values.${period}`)}><TextInput label={`${row.item} 자료 ${c.round} ${period} 원값 억원`} isLabelHidden size="sm" value={raw.items[row.item].values[period]} onChange={value=>updateItem(row.item,{values:{...raw.items[row.item].values,[period]:value}})} isDisabled={disabled||raw.items[row.item].mode==='unavailable'} {...bind(`cashflow.${c.round}.items.${row.item}.values.${period}`)}/></VStack>},
    ]}/>
   </>:<Text color="secondary">보유한 원자료가 있으면 이 회차를 사용해 입력할 수 있습니다.</Text>}
  </VStack>;
 }
 if(category==='economic')return <VStack gap={3}><Text color="secondary">현재·비교월의 공표 원값을 입력하세요. 대출금리는 공표 원금리 %이며 bp 변화량을 입력하지 않습니다. 자료가 없는 숫자는 공란으로 둡니다.</Text>
  <Table data={draft.catalog.economic.map(c=>({...c}))} idKey="key" density="compact" columns={[
   {key:'key',header:'경제지표·기간',width:proportional(2),renderCell:c=><VStack gap={1}><Text weight="medium">{c.key}</Text><Text color="secondary">현재 {c.currentMonth} · 비교 {c.referenceMonth} · {c.transform}</Text></VStack>},
   ...(['currentMonth','referenceMonth'] as const).map((period,i)=>({key:period,header:i===0?'현재월 원값':'비교월 원값',width:proportional(1),renderCell:(c:typeof draft.catalog.economic[number])=><VStack id={manualEntryFieldId(fieldIdentity,`economic.${c.key}.values.${c[period]}`)}><TextInput label={`${c.key} ${c[period]} ${i===0?'현재':'비교'} 원값`} size="sm" value={content.economic[c.key].values[c[period]]} onChange={value=>onChange({...content,economic:{...content.economic,[c.key]:{...content.economic[c.key],values:{...content.economic[c.key].values,[c[period]]:value}}}})} isDisabled={disabled} {...bind(`economic.${c.key}.values.${c[period]}`)}/></VStack>})),
   {key:'unit',header:'공유 단위·기준',width:proportional(2),renderCell:c=><VStack id={manualEntryFieldId(fieldIdentity,`economic.${c.key}.unitRaw`)}><TextInput label={`${c.key} 두 기간 동일 단위·기준`} size="sm" value={content.economic[c.key].unitRaw} onChange={unitRaw=>onChange({...content,economic:{...content.economic,[c.key]:{...content.economic[c.key],unitRaw}}})} isDisabled={disabled} {...bind(`economic.${c.key}.unitRaw`)}/></VStack>},
  ]}/></VStack>;
 const updateDay=(index:number,change:Partial<ManualEntryContentV1['funding']['days'][number]>)=>onChange({...content,funding:{...content.funding,days:content.funding.days.map((day,i)=>i===index?{...day,...change}:day)}});
 const bondLabels={publicAaa:'공사채 AAA 1년',treasury:'국고채 1년'};
 return <VStack gap={3}><Text>관측월 {draft.catalog.funding.observedMonth} · 마지막 평가일까지의 실제 평가일별 공표 3사 평균(%)을 입력하세요.</Text>
  {content.funding.days.length>0?<Table data={content.funding.days.map((day,index)=>({...day,index}))} idKey="rowId" density="compact" columns={[
   {key:'dateRaw',header:'실제 평가일',width:pixel(230),renderCell:row=><VStack id={manualEntryFieldId(fieldIdentity,`funding.days.${row.index}.dateRaw`)}><DateInput label={`조달금리 ${draft.catalog.funding.observedMonth} 평가일 ${row.index+1}`} size="sm" value={(row.dateRaw||undefined) as ComponentProps<typeof DateInput>['value']} onChange={value=>updateDay(row.index,{dateRaw:value??''})} placeholder="실제 평가일" format="system_date" isDisabled={disabled} {...bind(`funding.days.${row.index}.dateRaw`)}/></VStack>},
   ...(['publicAaa','treasury'] as const).map(bond=>({key:bond,header:`${bondLabels[bond]} 공표 평균 %`,width:pixel(240),renderCell:(row:typeof content.funding.days[number]&{index:number})=><VStack gap={2}><VStack id={manualEntryFieldId(fieldIdentity,`funding.days.${row.index}.${bond}.averageRaw`)}><TextInput label={`${bondLabels[bond]} ${row.dateRaw||`평가일 ${row.index+1}`} 공표 3사 평균 %`} size="sm" value={row[bond].averageRaw} onChange={averageRaw=>updateDay(row.index,{[bond]:{...row[bond],averageRaw}})} isDisabled={disabled} {...bind(`funding.days.${row.index}.${bond}.averageRaw`)}/></VStack><Collapsible trigger={`${bondLabels[bond]} 평가사별 참조금리`} isOpen={expandedReferences.has(`${row.rowId}.${bond}`)} onOpenChange={open=>onReferenceOpen?.(`${row.rowId}.${bond}`,open)}><VStack gap={2}>{draft.catalog.funding.agencies.map(agency=><VStack key={agency} id={manualEntryFieldId(fieldIdentity,`funding.days.${row.index}.${bond}.byAgencyRaw.${agency}`)}><TextInput key={agency} size="sm" label={`${bondLabels[bond]} ${row.dateRaw||`평가일 ${row.index+1}`} ${agency} 참조금리 %`} {...bind(`funding.days.${row.index}.${bond}.byAgencyRaw.${agency}`)} value={row[bond].byAgencyRaw[agency]} onChange={value=>updateDay(row.index,{[bond]:{...row[bond],byAgencyRaw:{...row[bond].byAgencyRaw,[agency]:value}}})} isDisabled={disabled}/></VStack>)}</VStack></Collapsible></VStack>})),
   {key:'delete',header:'행 삭제',width:pixel(100),renderCell:row=><Button label="삭제" aria-label={`평가일 ${row.index+1} 삭제`} size="sm" variant="ghost" isDisabled={disabled} onClick={()=>onChange({...content,funding:{...content.funding,days:content.funding.days.filter(d=>d.rowId!==row.rowId)}})}/>},
  ]}/>:<EmptyState isCompact title="입력된 평가일이 없습니다" description="실제 평가일을 추가하거나 자료 없음 사유를 입력하세요."/>}
  <Button label="평가일 추가" variant="secondary" size="sm" isDisabled={disabled||content.funding.days.length>=31} onClick={()=>{const bond=()=>({averageRaw:'',byAgencyRaw:Object.fromEntries(draft.catalog.funding.agencies.map(a=>[a,''])) as typeof content.funding.days[number]['publicAaa']['byAgencyRaw']});onChange({...content,funding:{...content.funding,days:[...content.funding.days,{rowId:crypto.randomUUID(),dateRaw:'',publicAaa:bond(),treasury:bond()}]}});}}/>
  {content.funding.days.length===0&&<VStack id={manualEntryFieldId(fieldIdentity,'funding.noDataReason')}><TextArea label={`조달금리 관측월 ${draft.catalog.funding.observedMonth} 자료 없음 사유`} value={content.funding.noDataReason} onChange={noDataReason=>onChange({...content,funding:{...content.funding,noDataReason}})} isReadOnly={disabled} {...bind('funding.noDataReason')}/></VStack>}
  <Text color="secondary">평가사별 값은 참고용입니다. 평균을 다시 계산하지 않으며 관측월 완료 여부는 서버의 실제 시각으로 검증합니다.</Text>
 </VStack>;
}
/** Field anchors survive tab changes; funding anchors follow row identity rather than position. */
export function manualEntryFieldId(draft:ManualEntryDraftDto,field:string){const stable=field.replace(/^funding\.days\.(\d+)/,(_match,index)=>`funding.days.${draft.content.funding.days[Number(index)]?.rowId??index}`);return `manual-field-${draft.draftId}-${encodeURIComponent(stable)}`;}
function manualEntryErrorField(error:ManualEntryFieldError,draft:ManualEntryDraftDto){const field=error.field;if(error.category==='cashflow'){const round=error.round??field.split('.')[1];if(field.endsWith('.items'))return `cashflow.${round}.items.${items[0]}.mode`;if(field.split('.').length<3)return `cashflow.${round}.asOfRaw`;}if(field==='funding.days')return draft.content.funding.days.length?'funding.days.0.dateRaw':'funding.noDataReason';return field;}
export function manualEntryFieldLabel(error:ManualEntryFieldError,draft:ManualEntryDraftDto){
 const parts=error.field.split('.');
 if(error.category==='cashflow'){const field=parts.at(-1);const label=parts.includes('values')?`적용 월 ${field} 원값`:field==='asOfRaw'?'원자료 기준일':field==='unavailableReason'?'자료 없음 사유':field==='enabled'?'회차 사용 여부':'항목 자료';return `자금자료 · 자료 ${error.round??parts[1]??''} · ${items.includes(parts[3] as ItemName)?parts[3]:''} · ${label}`;}
 if(error.category==='economic')return `경제지표 · ${parts[1]??''} · ${parts.at(-1)==='unitRaw'?'두 기간 동일 단위·기준':`${parts.at(-1)} 원값`}`;
 if(error.category==='funding'){if(parts[1]==='noDataReason')return `조달금리 · 관측월 ${draft.catalog.funding.observedMonth} · 자료 없음 사유`;const index=Number(parts[2]);const day=draft.content.funding.days[index];return `조달금리 · ${day?.dateRaw||`평가일 ${Number.isFinite(index)?index+1:''}`} · ${parts[3]==='publicAaa'?'공사채 AAA 1년':parts[3]==='treasury'?'국고채 1년':'실제 평가일'}${parts[4]==='byAgencyRaw'?` · ${parts[5]} 참조금리`:' · 공표 원자료'}`;}
 return error.field==='note'?'원자료 메모':'원자료 입력';
}
export function ManualEntryEditor({session,onLeave,onConfirmed,embedded=false,externalBusy=false,onNext,workspace=false}:{session:ManualEntrySession;onLeave:()=>void;onConfirmed:(id:string)=>void;embedded?:boolean;externalBusy?:boolean;onNext?:()=>void|Promise<void>;workspace?:boolean}){
 const state=useManualEntry(session);const [category,setCategory]=useState<Category>('cashflow');const [accept,setAccept]=useState(false);const [discard,setDiscard]=useState(false);const heading=useRef<HTMLHeadingElement>(null);const fields=useRef(new Map<string,HTMLInputElement|HTMLTextAreaElement>());const [focusError,setFocusError]=useState<{errors:readonly ManualEntryFieldError[];index:number}|null>(null);const [errorSelection,setErrorSelection]=useState<{errors:readonly ManualEntryFieldError[];index:number}|null>(null);const [expandedReferences,setExpandedReferences]=useState<ReadonlySet<string>>(new Set());
 const fieldRef=(field:string,node:HTMLInputElement|HTMLTextAreaElement|null)=>{if(node)fields.current.set(field,node);else fields.current.delete(field);};
 const [cashFocus,setCashFocus]=useState({draftId:state.draft.draftId,round:state.draft.reportCycle,month:state.draft.reportCycle});const [noteOpen,setNoteOpen]=useState(false);
 const cashSelection=useMemo(()=>cashFocus.draftId===state.draft.draftId?cashFocus:{round:state.draft.reportCycle,month:state.draft.reportCycle},[cashFocus,state.draft.draftId,state.draft.reportCycle]);
 const setCashSelection=useCallback((selection:{round:YearMonth;month:YearMonth})=>setCashFocus({draftId:state.draft.draftId,...selection}),[state.draft.draftId]);
 const {downloadHwpx,isDownloadingHwpx,hwpxDownloadError}=useReportHwpxDownload(state.review ? state.review.document.json as unknown as FinancialReport : null);
 const disabled=externalBusy||state.busy||state.completed||state.uncertain==='confirm';
 const targetField=useCallback((error:ManualEntryFieldError)=>manualEntryErrorField(error,{...state.draft,content:state.content}),[state.draft,state.content]);
 const goToError=useCallback((index:number,errors:readonly ManualEntryFieldError[])=>{if(session.snapshot.errors!==errors)return;const error=errors[index];if(!error)return;const selection={errors,index};setErrorSelection(selection);if(error.category!=='general')setCategory(error.category);const parts=error.field.split('.');if(parts[0]==='cashflow'){const round=state.draft.catalog.cashflow.find(value=>value.round===(error.round??parts[1]));if(round)setCashSelection({round:round.round,month:parts[4]==='values'&&round.months.includes(parts[5] as YearMonth)?parts[5] as YearMonth:round.round});}if(parts[0]==='funding'&&parts[4]==='byAgencyRaw'){const day=state.content.funding.days[Number(parts[2])];if(day)setExpandedReferences(previous=>new Set([...previous,`${day.rowId}.${parts[3]}`]));}if(error.field==='note')setNoteOpen(true);setFocusError(selection);},[session,state.draft.catalog.cashflow,state.content.funding.days,setCashSelection]);
 useEffect(()=>{let live=true;const errors=state.errors;if(errors[0])queueMicrotask(()=>{if(live)goToError(0,errors);});return()=>{live=false;};},[state.errors,goToError]);
 useEffect(()=>{if(!focusError||disabled||focusError.errors!==state.errors)return;const target=fields.current.get(targetField(focusError.errors[focusError.index]));if(target){const frame=requestAnimationFrame(()=>{if(session.snapshot.errors!==focusError.errors||!target.isConnected)return;target.focus({preventScroll:true});target.scrollIntoView({block:'center',inline:'nearest'});setFocusError(null);});return()=>cancelAnimationFrame(frame);}},[focusError,state.errors,category,cashSelection,noteOpen,expandedReferences,disabled,targetField,session]);
 const currentErrorIndex=errorSelection?.errors===state.errors?errorSelection.index:0;
 const currentError=state.errors[currentErrorIndex];
 const nextErrorIndex=state.errors.length?(currentErrorIndex+1)%state.errors.length:0;
 useEffect(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'start'});},[session]);
 const act=async(fn:()=>Promise<unknown>)=>{try{await fn();}catch{/* Session preserves raw and provides a message. */}};
 const leave=()=>act(async()=>{await session.drain();if(!session.snapshot.busy)onLeave();});
 return <VStack as="section" aria-label={workspace?"과거 원자료 입력":"새 보고서 직접 입력"} gap={workspace?6:3}>
 <VStack className="report-controls" gap={workspace?6:3}><Layout height="auto" padding={workspace?0:3} defaultHasDividers header={<LayoutHeader><VStack gap={2}>{!embedded&&<Heading level={workspace?1:3} tabIndex={-1} ref={heading}>{state.draft.catalog.basis.reportTitleMonth} {workspace?'자료 입력':'보고서 직접 입력'}</Heading>}<HStack gap={2} wrap="wrap"><Text type={workspace?"supporting":"body"}>보고월 {state.draft.catalog.basis.reportTitleMonth} · 자금자료 기준회차 {state.draft.reportCycle}</Text><Token label={{saved:'보관됨',saving:'보관 중',error:'보관 실패',conflict:'충돌 · 확인 필요'}[state.saveStatus]} color={state.saveStatus==='saved'?'green':state.saveStatus==='error'?'red':'gray'} size="sm"/><Text role="status" aria-live="polite">{state.message}</Text></HStack></VStack></LayoutHeader>} content={<LayoutContent isScrollable={false}><VStack gap={workspace?6:3}>
  {state.conflict&&<Banner status="warning" title="다른 변경과 충돌했습니다" description="내 입력을 유지하고 있습니다. 서버의 최신 내용을 조회하고 확인한 뒤 전환할 수 있습니다."/>}
  <TabList value={category} onChange={value=>setCategory(value as Category)} role="tablist" hasDivider size="sm">{Object.entries(categories).map(([value,label])=><Tab key={value} value={value} label={label} panelId={`manual-${value}`}/>)}</TabList>
  <VStack id={`manual-${category}`} role="tabpanel" aria-label={categories[category]} gap={workspace?6:3}><ManualEntryFields draft={state.draft} content={state.content} category={category} onChange={content=>session.change(content)} disabled={disabled} errors={state.errors} fieldRef={fieldRef} cashSelection={cashSelection} onCashSelection={setCashSelection} expandedReferences={expandedReferences} onReferenceOpen={(key,open)=>setExpandedReferences(previous=>{const next=new Set(previous);if(open)next.add(key);else next.delete(key);return next;})}/></VStack>
  <Collapsible trigger="자료 메모" isOpen={noteOpen} onOpenChange={setNoteOpen}><VStack id={manualEntryFieldId(state.draft,'note')} paddingBlock={3}><TextArea ref={node=>fieldRef('note',node)} label="원자료 메모" isOptional value={state.content.note} onChange={note=>session.change({...state.content,note})} maxLength={2000} isReadOnly={disabled}/></VStack></Collapsible>
  {currentError&&<Banner status="error" title="입력 항목을 확인해 주세요" description={`오류 ${state.errors.length}개 · ${currentErrorIndex+1}/${state.errors.length} · ${manualEntryFieldLabel(currentError,{...state.draft,content:state.content})} · ${currentError.message}`} collapsible={false} endContent={<Button label="다음 오류로 이동" aria-controls={manualEntryFieldId({...state.draft,content:state.content},targetField(state.errors[nextErrorIndex]))} size="sm" variant="secondary" isDisabled={disabled} onClick={()=>goToError(nextErrorIndex,state.errors)}/>}/>}
  {state.conflict?.latest&&<VStack gap={2}><Heading level={4}>서버에 보관된 최신 내용</Heading><Text>보고월 {state.conflict.latest.catalog.basis.reportTitleMonth} · 자료회차 {state.conflict.latest.reportCycle}</Text><ManualEntryFields draft={state.conflict.latest} content={state.conflict.latest.content} category={category} cashSelection={cashSelection} onChange={()=>{}} disabled/><Text>원자료 메모 · {state.conflict.latest.content.note||'없음'}</Text>{state.conflict.latest.existingConfirmation&&<Text>같은 월 확정본이 있습니다. 목록에서 확정본을 열거나 새 수정안을 작성하세요.</Text>}</VStack>}
  {state.review&&<VStack gap={3}><Heading level={4}>산출된 보고서 검토</Heading><Text>직접 입력한 원자료로 산출했습니다. 검토 결과와 포함·제외 자료를 확인해 주세요.</Text><Text>입력 자료회차 · {state.review.inputSummary.includedRounds.join(' · ')||'없음'}</Text><Text>제외 자료회차 · {state.review.inputSummary.omittedRounds.join(' · ')||'없음'}</Text><Text>항목 전체 자료 없음 · {state.review.inputSummary.unavailableItems.map(v=>`${v.round} ${v.item}: ${v.reason}`).join(' · ')||'없음'}</Text><Text>경제 원값 공란 · {state.review.inputSummary.missingEconomic.map(v=>`${v.key} ${v.month}`).join(' · ')||'없음'}</Text><Text>조달 평가일 · {state.review.inputSummary.fundingDates.join(' · ')||'없음'} · 공표금리 결측 {state.review.inputSummary.fundingMissing.length}건</Text></VStack>}
 </VStack></LayoutContent>} footer={<LayoutFooter><HStack gap={2} wrap="wrap">{(state.conflict||state.saveStatus==='error')&&!state.uncertain&&<Button label="미보관 입력 포기" variant="ghost" isDisabled={externalBusy||state.busy} onClick={()=>setDiscard(true)}/>}<Button label="보관하고 목록으로" variant="ghost" isDisabled={externalBusy||state.busy||!!state.uncertain} onClick={()=>void leave()}/>{state.conflict&&<><Button label="최신 내용 조회·비교" variant="secondary" isDisabled={externalBusy||state.busy} onClick={()=>void act(()=>session.readConflictLatest())}/><Button label="서버 내용으로 전환" variant="secondary" isDisabled={externalBusy||!state.conflict.latest||state.busy} onClick={()=>setAccept(true)}/></>}{(state.saveStatus==='error'||state.uncertain)&&<Button label={state.uncertain?'같은 요청으로 결과 확인':'보관 다시 시도'} variant="secondary" isDisabled={externalBusy||state.busy} onClick={()=>void act(async()=>{const result=await session.retry();if(result&&'confirmationId' in result)onConfirmed(result.confirmationId);})}/>}<Button label="임시보관" variant="secondary" isDisabled={disabled||!!state.uncertain||!!state.conflict} onClick={()=>void act(()=>session.drain())}/>{onNext&&<Button label="보관하고 다음 달 입력" variant="primary" isDisabled={disabled||!!state.uncertain||!!state.conflict||state.saveStatus==='error'} onClick={()=>void onNext()}/>}<Button label="보고서 검토" variant="secondary" isDisabled={disabled||!!state.conflict||state.saveStatus==='error'||!!state.uncertain} onClick={()=>void act(()=>session.prepare())}/><Button label="보고서 확정" isDisabled={externalBusy||!session.canConfirm} isLoading={state.busy} onClick={()=>void act(async()=>{const result=await session.confirm();if(result)onConfirmed(result.confirmationId);})}/></HStack></LayoutFooter>}/>
 {accept&&<Banner status="warning" title="내 미보관 입력을 버리고 전환할까요?" description="서버에 보관된 내용으로 전환하며 내 미보관 입력을 버립니다." endContent={<HStack gap={2}><Button label="내 입력 유지" variant="ghost" onClick={()=>setAccept(false)}/><Button label="미보관 입력 버리고 전환" variant="secondary" onClick={()=>{session.acceptConflictLatest();setAccept(false);}}/></HStack>}/>}
 {discard&&<Banner status="warning" title="미보관 입력을 포기할까요?" description="화면의 미보관 입력을 버리고 목록으로 돌아갑니다. 마지막으로 확인된 보관 내용은 서버에 남습니다." endContent={<HStack gap={2}><Button label="입력 계속하기" variant="ghost" onClick={()=>setDiscard(false)}/><Button label="미보관 입력 포기하고 목록으로" variant="secondary" onClick={onLeave}/></HStack>}/>}
 </VStack>
 {state.review&&<><DocumentThemeProvider><FinancialReportPreview report={state.review.document.json as unknown as FinancialReport} onDownloadHwpx={downloadHwpx} isDownloadingHwpx={isDownloadingHwpx} hwpxDownloadError={hwpxDownloadError}/></DocumentThemeProvider><ManualEntryPrintHost review={state.review}/></>}
 </VStack>;
}
export type ManualEntrySurfaces = { readonly entry: ReactNode; readonly pending: ReactNode };
type ManualEntryControlsProps = {
 onConfirmed:(id:string)=>void;refreshRevision?:number;
 registerStart:(start:((trigger?:HTMLElement)=>void)|null)=>void;
 registerNavigationGuard:(guard:(()=>Promise<boolean>)|null)=>void;
 beforeEntryOpen?:()=>Promise<boolean>;onEntryOpened?:()=>void;
 client?:ManualEntryClient;presentation?:'dialog'|'workspace';render?:(surfaces:ManualEntrySurfaces)=>ReactNode;
};
export function ManualEntryControls({onConfirmed,refreshRevision=0,registerStart,registerNavigationGuard,beforeEntryOpen,onEntryOpened,client:provided,presentation='dialog',render}:ManualEntryControlsProps){
 const client=useMemo(()=>provided??createManualEntryClient(),[provided]);
 const [session,setSession]=useState<ManualEntrySession|null>(null);const sessionRef=useRef<ManualEntrySession|null>(null);
 const [items,setItems]=useState<readonly ManualEntrySummary[]>([]);const saved=useRef<readonly ManualEntrySummary[]>([]);
 const [cursor,setCursor]=useState<string|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [open,setOpen]=useState(false);const [year,setYear]=useState(()=>String(new Date().getFullYear()));const [month,setMonth]=useState(()=>String(new Date().getMonth()+1).padStart(2,'0'));
 const [actionBusy,setActionBusy]=useState(false);const actionInFlight=useRef(false);const [createError,setCreateError]=useState('');
 const createCommand=useRef<{reportTitleMonth:YearMonth;idempotencyKey:string}|null>(null);const createFromNext=useRef(false);
 const [createUnknown,setCreateUnknown]=useState(false);const unknownRef=useRef(false);const generation=useRef(0);
 const returnTrigger=useRef<HTMLElement|null>(null);const returnDraft=useRef<string|null>(null);const pendingHeading=useRef<HTMLHeadingElement>(null);
 const pickerHeading=useRef<HTMLHeadingElement>(null);
 const resumeButtons=useRef(new Map<string,HTMLButtonElement>());const [restoreFocus,setRestoreFocus]=useState(false);const [showPending,setShowPending]=useState(false);
 const adopt=useCallback((next:ManualEntrySession|null)=>{sessionRef.current=next;setSession(next);},[]);
 const unknown=useCallback((next:boolean)=>{unknownRef.current=next;setCreateUnknown(next);},[]);
 const load=useCallback(async(next?:string)=>{const g=++generation.current;setBusy(true);setError('');try{const page=await loadManualEntryPage(client,next,saved.current);if(g!==generation.current)return;saved.current=page.items;setItems(page.items);setCursor(page.nextCursor);}catch{if(g===generation.current)setError('작성 중인 보고서를 불러오지 못했습니다.');}finally{if(g===generation.current)setBusy(false);}},[client]);
 useEffect(()=>{let live=true;queueMicrotask(()=>{if(live)void load();});return()=>{live=false;};},[load,refreshRevision]);
 useEffect(()=>{if(!restoreFocus||busy||session||open)return;const frame=requestAnimationFrame(()=>{const target=returnTrigger.current?.isConnected?returnTrigger.current:(returnDraft.current?resumeButtons.current.get(returnDraft.current):null)??pendingHeading.current;target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'});setRestoreFocus(false);});return()=>cancelAnimationFrame(frame);},[restoreFocus,busy,session,open,items]);
 useEffect(()=>{if(presentation!=='workspace'||session||!open)return;const frame=requestAnimationFrame(()=>{pickerHeading.current?.focus({preventScroll:true});pickerHeading.current?.scrollIntoView({block:'start'});});return()=>cancelAnimationFrame(frame);},[presentation,session,open]);
 const drainCurrent=useCallback(async()=>{const current=sessionRef.current;if(!current)return true;try{await current.drain();return !current.hasUnacknowledged&&!current.snapshot.busy&&!current.snapshot.conflict&&current.snapshot.saveStatus==='saved'&&!current.snapshot.uncertain;}catch{return false;}},[]);
 const close=async()=>{if(actionInFlight.current||unknownRef.current)return;actionInFlight.current=true;setActionBusy(true);sessionRef.current?.dispose();adopt(null);setShowPending(true);try{await load();}finally{actionInFlight.current=false;setActionBusy(false);setRestoreFocus(true);}};
 const closeSaved=async()=>{if(actionInFlight.current||unknownRef.current)return;actionInFlight.current=true;setActionBusy(true);try{if(!await drainCurrent())return;sessionRef.current?.dispose();adopt(null);setOpen(false);setShowPending(true);await load();setRestoreFocus(true);}finally{actionInFlight.current=false;setActionBusy(false);}};
 const externalLeave=useCallback(async()=>{
  if(actionInFlight.current||unknownRef.current)return false;
  actionInFlight.current=true;setActionBusy(true);
  try{if(!await drainCurrent())return false;sessionRef.current?.dispose();adopt(null);setOpen(false);setRestoreFocus(false);setShowPending(true);void load();return true;}
  finally{actionInFlight.current=false;setActionBusy(false);}
 },[adopt,drainCurrent,load]);
 useEffect(()=>{registerNavigationGuard(externalLeave);return()=>registerNavigationGuard(null);},[registerNavigationGuard,externalLeave]);
 useEffect(()=>{registerStart(trigger=>{
  if(actionInFlight.current||unknownRef.current)return;
  actionInFlight.current=true;setActionBusy(true);
  void (async()=>{try{if(!await drainCurrent())return;returnTrigger.current=trigger??null;returnDraft.current=null;sessionRef.current?.dispose();adopt(null);setOpen(true);setCreateError('');setRestoreFocus(false);}finally{actionInFlight.current=false;setActionBusy(false);}})();
 });return()=>registerStart(null);},[registerStart,adopt,drainCurrent]);
 useEffect(()=>{const unload=(event:BeforeUnloadEvent)=>{if(unknownRef.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[]);
 const resume=async(id:string,trigger:HTMLElement)=>{
  if(actionInFlight.current||unknownRef.current)return;
  actionInFlight.current=true;setActionBusy(true);setError('');
  try{if(beforeEntryOpen&&!await beforeEntryOpen())return;if(!await drainCurrent())return;const current=await client.resume(id);returnTrigger.current=trigger;returnDraft.current=id;sessionRef.current?.dispose();adopt(new ManualEntrySession(current,client));setCreateError('');onEntryOpened?.();}
  catch(cause){setError(manualEntryErrorMessage(cause));}
  finally{actionInFlight.current=false;setActionBusy(false);}
 };
 let selected:YearMonth|null=null;
 try{if(/^\d{4}$/.test(year)){selected=yearMonth(Number(year),Number(month));addMonths(selected,1);}}catch{selected=null;}
 const create=async(target:YearMonth|null=selected,fromNext=false,retry=false)=>{
  if(actionInFlight.current||(unknownRef.current&&!retry)||(!createCommand.current&&!target))return;
  actionInFlight.current=true;setActionBusy(true);setCreateError('');let attempted=false;
  try{
   if(!retry&&beforeEntryOpen&&!await beforeEntryOpen())return;
   if(!retry&&!await drainCurrent())return;
   if(!createCommand.current){createCommand.current={reportTitleMonth:target!,idempotencyKey:crypto.randomUUID()};createFromNext.current=fromNext;}
   const command=createCommand.current;attempted=true;
   const ack=await client.create(command);const current=await client.resume(ack.draftId);
   if(current.draftId!==ack.draftId||current.catalog.basis.reportTitleMonth!==command.reportTitleMonth)throw new ManualEntryClientError(0,'ACK_MISMATCH');
   if(current.state==='confirmed'||current.state==='month-conflict')throw new ManualEntryClientError(409,'MONTH_ALREADY_CONFIRMED');
   sessionRef.current?.dispose();adopt(new ManualEntrySession(current,client));returnDraft.current=current.draftId;
   setYear(command.reportTitleMonth.slice(0,4));setMonth(command.reportTitleMonth.slice(5));createCommand.current=null;unknown(false);setOpen(false);setRestoreFocus(false);void load();onEntryOpened?.();
  }catch(cause){
   if(attempted){const definite=cause instanceof ManualEntryClientError&&cause.status>=400&&cause.status<500&&![408,429].includes(cause.status);unknown(!definite);if(definite)createCommand.current=null;
    setCreateError(cause instanceof ManualEntryClientError&&cause.status===409?'같은 월 확정본이 있습니다. 덮어쓸 수 없습니다. 보관한 보고서에서 확정본을 열거나 새 수정안을 작성하세요.':manualEntryErrorMessage(cause));}
  }finally{actionInFlight.current=false;setActionBusy(false);}
 };
 const next=()=>{const current=sessionRef.current;if(!current||actionInFlight.current||unknownRef.current)return;void create(addMonths(current.snapshot.draft.catalog.basis.reportTitleMonth,1),true);};
 const retryCreate=()=>void create(createCommand.current?.reportTitleMonth??selected,createFromNext.current,true);
 const confirmed=(id:string)=>{sessionRef.current?.dispose();adopt(null);void load();onConfirmed(id);};
 const picker=<VStack gap={presentation==='workspace'?6:4}>
  {presentation==='workspace'&&<VStack gap={2}><Heading level={1} id="workspace-heading" tabIndex={-1} ref={pickerHeading}>과거 자료 등록</Heading><Text color="secondary" textWrap="pretty">운영 담당자가 보유한 자금자료·경제지표·금리를 보고월별로 입력합니다.</Text></VStack>}
  <HStack gap={presentation==='workspace'?4:3} wrap="wrap"><TextInput label="보고 연도" value={year} width="10ch" onChange={value=>{if(actionInFlight.current||unknownRef.current)return;setYear(value);createCommand.current=null;}} isDisabled={actionBusy||createUnknown} status={selected===null?{type:'error',message:'보고 연도를 네 자리로 입력하세요.'}:undefined}/><Selector label={presentation==='workspace'?'보고월':'보고월 월'} value={month} options={Array.from({length:12},(_,index)=>({value:String(index+1).padStart(2,'0'),label:(index+1)+'월'}))} onChange={value=>{if(actionInFlight.current||unknownRef.current)return;setMonth(value);createCommand.current=null;}} isDisabled={actionBusy||createUnknown}/></HStack>
  {selected&&<Text type={presentation==='workspace'?'supporting':'body'} color="secondary">보고월 {selected} · 자금자료 기준회차 {addMonths(selected,1)}</Text>}
  {createError&&<Banner status="warning" title="과거 자료 등록 안내" description={createError}/>}
  <HStack gap={2} wrap="wrap"><Button label={createUnknown?'같은 요청으로 생성 결과 확인':presentation==='workspace'?'선택한 월 자료 입력':'작성 시작·같은 월 이어서 작성'} isLoading={actionBusy} isDisabled={!selected||actionBusy} variant="primary" onClick={()=>createUnknown?retryCreate():void create()}/>{presentation==='dialog'&&!createUnknown&&<Button label="닫기" variant="ghost" isDisabled={actionBusy} onClick={()=>{setOpen(false);setRestoreFocus(true);}}/>}</HStack>
 </VStack>;
 const pending=(items.length>0||busy||error||showPending)?<VStack as="section" gap={2} className="report-controls" aria-label="작성 중인 새 보고서">
  <HStack gap={2} wrap="wrap"><Heading level={presentation==='workspace'?2:3} ref={pendingHeading} tabIndex={-1}>입력 중인 월</Heading><Button label="작성 중인 보고서 새로고침" size="sm" variant="ghost" isDisabled={busy||actionBusy} onClick={()=>void load()}/></HStack>
  {busy&&<Text role="status">작성 중인 보고서 조회 중</Text>}
  {!busy&&!error&&items.length===0&&showPending&&<Text>작성 중인 새 보고서가 없습니다.</Text>}
  {items.length>0&&<ManualEntryPendingTable items={items} onResume={(id,trigger)=>void resume(id,trigger)} resumeRef={(id,node)=>{if(node)resumeButtons.current.set(id,node);else resumeButtons.current.delete(id);}}/>}
  {cursor&&<Button label="작성 중인 보고서 더 보기" size="sm" variant="secondary" isDisabled={busy||actionBusy} onClick={()=>void load(cursor)}/>}
  {error&&<Banner status="warning" title={error} endContent={<Button label="다시 조회" size="sm" variant="secondary" onClick={()=>void load()}/>}/>}
 </VStack>:null;
 const editor=session?<ManualEntryEditor key={session.snapshot.draft.draftId} session={session} embedded={presentation==='dialog'} workspace={presentation==='workspace'} externalBusy={actionBusy||createUnknown} onNext={next} onLeave={()=>void close()} onConfirmed={confirmed}/>:null;
 const entry=session?<VStack gap={3}>
  {(createError||createUnknown)&&<VStack className="report-controls"><Banner status="warning" title="다음 월 자료 등록 안내" description={createError} endContent={createUnknown?<Button label="다음 월 생성 결과 확인" isLoading={actionBusy} onClick={retryCreate}/>:undefined}/></VStack>}
  {editor}
 </VStack>:picker;
 if(render)return render({entry,pending});
 if(presentation==='workspace')return <VStack gap={6}>{entry}{!session&&pending}</VStack>;
 return <VStack gap={3} className="report-controls">
  {session?<Dialog isOpen purpose="form" variant="fullscreen" onOpenChange={value=>{if(!value)void closeSaved();}}><Layout header={<DialogHeader title={session.snapshot.draft.catalog.basis.reportTitleMonth+' 원자료 입력'} onOpenChange={value=>{if(!value)void closeSaved();}}/>} content={<LayoutContent>{entry}</LayoutContent>}/></Dialog>:pending}
  <Dialog isOpen={open} onOpenChange={value=>{if(!actionInFlight.current&&!unknownRef.current){setOpen(value);if(!value)setRestoreFocus(true);}}} purpose="form"><DialogHeader title="과거 자료 등록" onOpenChange={value=>{if(!actionInFlight.current&&!unknownRef.current){setOpen(value);if(!value)setRestoreFocus(true);}}}/>{picker}</Dialog>
 </VStack>;
}
