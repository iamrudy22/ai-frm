import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteHistoryRepository, hashHistoryValue } from './sqlite-history-repository';
import { SCORING_RULES } from '../../domain/risk/construction-perception/policy';
import { yearMonth } from '../../domain/shared/year-month';
import type { DraftContent } from '../../domain/report-history/correction';
import * as work from '../../application/report-history/correction-work';
import * as correction from '../../application/report-history/report-correction';
const dirs:string[]=[], repos:SqliteHistoryRepository[]=[];
const now='2026-10-23T00:00:00.000Z', version='risk-policy-2026-09-28@e3a8f9e';
const basis={reportCycle:yearMonth(2026,9),reportTitleMonth:yearMonth(2026,8),constructionBaseMonth:yearMonth(2026,7),fundingJudgedMonth:yearMonth(2026,9),fundingObservedMonth:yearMonth(2026,8),gapMonth:yearMonth(2026,9)};
function open(){const d=mkdtempSync(join(tmpdir(),'w3-synthetic-'));dirs.push(d);const r=new SqliteHistoryRepository(join(d,'history.sqlite'),{now:()=>now});repos.push(r);return r;}
afterEach(()=>{for(const r of repos.splice(0))r.close();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
async function correctionFixture(options: { unreadable?: boolean; noFetchedAt?: boolean; future?: boolean; history?: boolean; failedEcos?: boolean } = {}) {
  const [{ captureConstruction, captureFunding }, { prepareReportCandidate, restoreStatement }, { ledgerOf }, { roundEntryOf }, codec, sources] = await Promise.all([
    import('../../application/report-history/report-history'), import('../../application/report-history/report-candidate'), import('../../domain/cashflow/forecast-ledger'), import('../../domain/cashflow/round-entry'), import('./evidence-codec'), import('./captured-sources'),
  ]);
  const r = open(), scopeId = await r.defaultScopeId();
  const source = Object.fromEntries((await import('../../domain/risk/construction-perception/policy')).SCORING_RULES.filter(rule=>rule.key !== '분양회수예측오차').map(rule=>[rule.key,{ unit:'지수', values:new Map([[yearMonth(2026,7),110],[yearMonth(2026,6),100],[yearMonth(2025,7),100]]), ...(options.noFetchedAt ? {} : {fetchedAt:new Date(now)}) }])) as never;
  if(options.failedEcos)(source as Record<string,unknown>).총수주액={error:'합성 조회 실패'};
  let calls = 0;
  const deps = { repository:r, indicators:{fetchAll:async()=>source}, yields:{dailyYields:async()=>({days:[{date:'2026/08/31',publicAaa:{average:3.674,byAgency:{A:99}},treasury:{average:2.5,byAgency:{A:99}}}],fetchedAt:new Date(now)})},
    clock:(()=>{let tick=0;return ()=>new Date((options.future?'2026-07-01T00:00:00.000Z':tick++===0?now:'2026-10-23T00:00:00.001Z'));})(),metadataClock:()=>new Date('2026-11-01T01:00:00.000Z'),hash:hashHistoryValue,encode:codec.evidenceToJson,decode:codec.evidenceFromJson,calculationVersion:version,
    captureIndicators:sources.captureEconomicSource,captureYields:sources.captureBondSource,replayIndicators:sources.replayEconomicSource,replayYields:sources.replayBondSource,isUnsafe:sources.containsSourceCredentials,
    nextId:()=>crypto.randomUUID(),ecosCatalog:SCORING_RULES.filter(rule=>rule.key!=='분양회수예측오차').map(rule=>({key:rule.key,stat:'SYNTHETIC',items:['I']})),
    documentFactory: (input: import('../../application/report-history/report-candidate').RestoredReportInput, selection: import('../../application/report-history/ports').ExternalHistorySelection) => {
      const json = codec.evidenceToJson({ dashboard:input.dashboard,construction:input.constructionOutcome,funding:input.fundingOutcome,authoredAt:input.authoredAt });
      return { schemaVersion:1 as const,templateVersion:'report@e3a8f9e',contentHash:hashHistoryValue(json),json,historyCalculationIds:selection.historyCalculationIds };
    },
  } as unknown as import('../../application/report-history/ports').ReportCorrectionDependencies;
  const statements = [6,8,9].map(month=>({asOf:{year:2026,month,day:28},monthLabels:Array.from({length:12},(_,i)=>`${i+1}월`),baseMonthIndex:month-1,planYearEndIndex:11,amounts:{기초시재:Array(12).fill(100),수입계:Array(12).fill(50),수입:Array(12).fill(40),분양회수:Array(12).fill(30),기타수입:Array(12).fill(10),지출:Array(12).fill(60)}}));
  if(options.unreadable)(statements[0].amounts as unknown as Record<string,unknown>).수입={unreadable:'합성 판독 불가'};
  const ledger = ledgerOf(statements.map(restoreStatement).map(roundEntryOf));
  const c = await captureConstruction(deps,scopeId,{reportMonth:basis.reportCycle},ledger), f = await captureFunding(deps,scopeId,{judgedMonth:basis.fundingJudgedMonth});
  if(c.history.captureStatus!=='saved'||f.history.captureStatus!=='saved') throw Error('fixture failed');
  const selection = await r.createHistorySelection({scopeId,basis,calculationVersion:version,asOf:now,selectedBackfillBatchId:null});
  const documentFactory = (deps as unknown as {documentFactory:import('../../application/report-history/report-candidate').ReportDocumentFactory}).documentFactory;
  const candidate = await prepareReportCandidate(deps,{scopeId,basis,statements,sourceMetadata:{files:['synthetic-june','synthetic-aug','synthetic-sept']},constructionCalculationId:c.history.calculationId,fundingCalculationId:f.history.calculationId,historySelectionId:selection.historySelectionId,authoredAt:now,inputGeneration:'fixture'},documentFactory);
  const confirmed = await r.commitConfirmation(scopeId,{candidateId:candidate.candidateId,expectedRevision:0,idempotencyKey:'fixture'});
  if(confirmed.kind!=='confirmed') throw Error('fixture failed');
  const disabled = {...deps,workbookCodec:new Proxy({}, {get(){throw Error('CODEC_CALL');}}),indicators:{fetchAll:async()=>{calls++;throw Error('LIVE_CALL');}},yields:{dailyYields:async()=>{calls++;throw Error('LIVE_CALL');}}};
  const counts = () => { const db = new DatabaseSync(r.databasePath); const result = Object.fromEntries(['source_capture','report_input_snapshot','calculation_record','report_candidate','correction_preview','monthly_confirmation','monthly_head','correction_draft'].map(table=>[table,Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n)])); db.close(); return result; };
  return {r,scopeId,deps:disabled,counts,calls:()=>calls,confirmed,candidate,statements};
}

async function draft(f:Awaited<ReturnType<typeof correctionFixture>>, content?:DraftContent) {
  const editor=await correction.prepareCorrectionEditor(f.deps,f.scopeId,f.confirmed.confirmationId);
  const result=await work.createCorrectionDraft(f.deps,f.scopeId,{basisId:editor.basisId,idempotencyKey:crypto.randomUUID(),content:content??{edits:[{rowId:editor.rows.find(r=>r.category==='cashflow')!.rowId,action:'set',rawValue:'0'}],reason:'합성 정정',evidenceNote:''}});
  if(result==='empty')throw Error('expected draft');return result;
}
it('web_edit_replays_original_sources_and_clock_without_codec; preview_changes_inputs_but_not_heads_or_other_reports',async()=>{
 const f=await correctionFixture(),d=await draft(f),before=f.counts();
 const reviewed=await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:1});
 expect(reviewed.kind).toBe('preview');if(reviewed.kind!=='preview')throw Error('preview');
 const p=await f.r.getCorrectionPreview(f.scopeId,reviewed.previewId),c=await f.r.getCandidate(f.scopeId,p!.candidateId),input=await f.r.getInputSnapshot(f.scopeId,c!.inputSnapshotId);
 expect(input!.statements[0].amounts.기초시재).toEqual([0,...Array(11).fill(100)]);expect(input!.statements[0].amounts.수입계).toEqual(Array(12).fill(50));
 for(const indicator of ['construction','funding'] as const){const old=await f.r.getCalculation(f.scopeId,f.candidate.document? (await f.r.getCandidate(f.scopeId,f.candidate.candidateId))!.calculationIds[indicator]:'');const next=await f.r.getCalculation(f.scopeId,c!.calculationIds[indicator]);expect(next!.evaluationClockTrace).toEqual(old!.evaluationClockTrace);expect(next!.resultJson).toEqual(old!.resultJson);}
 expect(f.counts().monthly_confirmation).toBe(before.monthly_confirmation);expect(f.counts().monthly_head).toBe(before.monthly_head);expect(f.calls()).toBe(0);
});
it('draft_resume_keeps_identity_and_unsaved_state_distinct; empty_new_draft_is_not_persisted',async()=>{
 const f=await correctionFixture(),editor=await correction.prepareCorrectionEditor(f.deps,f.scopeId,f.confirmed.confirmationId),before=f.counts();
 expect(await work.createCorrectionDraft(f.deps,f.scopeId,{basisId:editor.basisId,idempotencyKey:'empty',content:{edits:[],reason:'',evidenceNote:''}})).toBe('empty');expect(f.counts()).toEqual(before);
 const d=await draft(f,{edits:[{rowId:editor.rows[0].rowId,action:'set',rawValue:'-.'}],reason:'',evidenceNote:''});expect(await work.getCorrectionDraft(f.r,f.scopeId,d.draftId)).toEqual(d);
 expect(await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:1})).toMatchObject({kind:'invalid'});
});
it('preview_uses_acknowledged_exact_draft_revision; same_current_draft_preview_retry_is_idempotent; reason_change_invalidates_confirmation',async()=>{
 const f=await correctionFixture(),d=await draft(f);await expect(correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:0})).rejects.toMatchObject({code:'STALE_DRAFT'});
 const first=await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:1}),before=f.counts();
 expect(await correction.previewCorrectionDraft({...f.deps,nextId:()=>{throw Error('NEW_ID');}},f.scopeId,{draftId:d.draftId,expectedDraftRevision:1})).toEqual(first);expect(f.counts()).toEqual(before);
 const saved=await work.saveCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:1,idempotencyKey:'reason',content:{...d.content,reason:'다른 사유'}});expect(saved.currentPreviewId).toBeNull();
 if(first.kind!=='preview')throw Error('preview');expect(await correction.confirmCorrection(f.deps,f.scopeId,{...first,expectedBaseRevision:1,idempotencyKey:'old',reason:'합성 정정'})).toMatchObject({kind:'conflict'});
});
it('closed_review_copy_preserves_source_and_requires_explicit_reapply; read_only_detail_preserves_baseline_and_calls_no_writers',async()=>{
 const f=await correctionFixture(),d=await draft(f),ref={kind:'draft' as const,id:d.draftId};await work.closeCorrectionWork(f.deps,f.scopeId,{ref,expectedDraftRevision:1,idempotencyKey:'close'});
 const detail=await work.getCorrectionReviewDetail(f.r,f.scopeId,ref),before=f.counts(),copy=await work.copyClosedCorrectionWork(f.deps,f.scopeId,{ref,idempotencyKey:'copy'});expect(copy).toMatchObject({requiresReapply:true});expect(await work.getCorrectionReviewDetail(f.r,f.scopeId,ref)).toEqual(detail);
 if('kind' in copy)throw Error('draft');await expect(correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:copy.draftId,expectedDraftRevision:1})).rejects.toMatchObject({code:'INVALID_DRAFT'});
 const reapplied=await work.reapplyCorrectionDraft(f.deps,f.scopeId,{draftId:copy.draftId,expectedDraftRevision:1,expectedLatestConfirmationId:f.confirmed.confirmationId,idempotencyKey:'reapply'});expect(reapplied).toMatchObject({requiresReapply:false,draftRevision:2});
 expect(before.monthly_confirmation).toBe(f.counts().monthly_confirmation);
 const readonly=new Proxy(f.r,{get(t,k){if(String(k).startsWith('put')||String(k).startsWith('write')||String(k).startsWith('create')||String(k).startsWith('stage'))return ()=>{throw Error('WRITER');};const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});expect(await work.getCorrectionReviewDetail(readonly,f.scopeId,ref)).toEqual(detail);
});

it('editor_open_requires_latest_head_but_legacy_detail_is_readable; browser DTO hides all locators',async()=>{
 const f=await correctionFixture(),d=await draft(f),stored=await f.r.getCandidate(f.scopeId,f.candidate.candidateId);
 for(const row of d.editor.rows){expect(row).not.toHaveProperty('sourceIdentity');expect(row).not.toHaveProperty('fieldPath');expect(row).not.toHaveProperty('sourceRecordId');}
 const next=await f.r.putCandidate({...stored!,document:{...stored!.document,contentHash:'synthetic-later'}});await f.r.commitConfirmation(f.scopeId,{candidateId:next.candidateId,expectedRevision:1,idempotencyKey:'later',correctionReason:'합성 변경'});
 await expect(correction.prepareCorrectionEditor(f.deps,f.scopeId,f.confirmed.confirmationId)).rejects.toMatchObject({code:'STALE_BASE'});
 expect((await work.getCorrectionReviewDetail(f.r,f.scopeId,{kind:'draft',id:d.draftId})).rows[0].originalText).toBe('100');
});
it('web unpublished ECOS series cannot be created; stored 9-series basis preserves original numeric precision',async()=>{
 const f=await correctionFixture({failedEcos:true}),editor=await correction.prepareCorrectionEditor(f.deps,f.scopeId,f.confirmed.confirmationId);
 const failed=editor.rows.filter(r=>r.label==='총수주액');expect(failed).toHaveLength(2);expect(failed.every(r=>r.allowedActions.length===0)).toBe(true);
 await expect(work.createCorrectionDraft(f.deps,f.scopeId,{basisId:editor.basisId,idempotencyKey:'forbidden',content:{edits:[{rowId:failed[0].rowId,action:'set',rawValue:'10'}],reason:'합성',evidenceNote:''}})).rejects.toMatchObject({code:'INVALID_DRAFT'});
 expect(editor.rows.filter(r=>r.category==='economic')).toHaveLength(18);expect(editor.rows.find(r=>r.category==='cashflow')).toMatchObject({sourceRound:'2026/06',period:'2026/01'});
});
it('web unreadable recovery requires all original months and never fills partial or adds months',async()=>{
 const f=await correctionFixture({unreadable:true}),editor=await correction.prepareCorrectionEditor(f.deps,f.scopeId,f.confirmed.confirmationId),rows=editor.rows.filter(r=>r.originalState==='unreadable');expect(rows).toHaveLength(12);
 const d=await draft(f,{edits:[{rowId:rows[0].rowId,action:'set',rawValue:'40'}],reason:'합성 복구',evidenceNote:''}),before=f.counts();
 expect(await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:1})).toMatchObject({kind:'invalid',errors:[{code:'INCOMPLETE_REPAIR'}]});expect(f.counts()).toEqual(before);
 const saved=await work.saveCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:1,idempotencyKey:'repair',content:{...d.content,edits:rows.map(row=>({rowId:row.rowId,action:'set',rawValue:'40'}))}});
 const result=await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:saved.draftRevision});if(result.kind!=='preview')throw Error('preview');const p=await f.r.getCorrectionPreview(f.scopeId,result.previewId),input=await f.r.getInputSnapshot(f.scopeId,p!.inputSnapshotId);expect(input!.statements[0].amounts.수입).toEqual(Array(12).fill(40));
});
it('web KOFIA applies only published average preserving agency reference and original receive time',async()=>{
 const f=await correctionFixture(),editor=await correction.prepareCorrectionEditor(f.deps,f.scopeId,f.confirmed.confirmationId),row=editor.rows.find(r=>r.category==='funding')!,d=await draft(f,{edits:[{rowId:row.rowId,action:'set',rawValue:'3.7'}],reason:'평균 정정',evidenceNote:''});
 const result=await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:1});if(result.kind!=='preview')throw Error('preview');const p=await f.r.getCorrectionPreview(f.scopeId,result.previewId),c=await f.r.getCandidate(f.scopeId,p!.candidateId),calc=await f.r.getCalculation(f.scopeId,c!.calculationIds.funding),evidence=await f.r.getEvidence(f.scopeId,calc!.captureIds[0]);
 expect(f.deps.decode!<{value:{days:unknown[]}}>(evidence!.payloadJson).value.days[0]).toMatchObject({publicAaa:{average:3.7,byAgency:{A:99}},treasury:{average:2.5,byAgency:{A:99}}});const oldCandidate=await f.r.getCandidate(f.scopeId,f.candidate.candidateId),oldCalculation=await f.r.getCalculation(f.scopeId,oldCandidate!.calculationIds.funding),oldEvidence=await f.r.getEvidence(f.scopeId,oldCalculation!.captureIds[0]);expect(evidence!.receivedAt).toBe(oldEvidence!.receivedAt);expect(f.calls()).toBe(0);
});
it('no-change preview creates no derived records; edited equivalent patch creates new exact revision identity',async()=>{
 const f=await correctionFixture(),d=await draft(f),first=await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:1});
 const same=await work.saveCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:1,idempotencyKey:'same',content:{...d.content,edits:[{...d.content.edits[0],rawValue:'100'}]}}),before=f.counts();
 expect(await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:same.draftRevision})).toEqual({kind:'no-change'});expect(f.counts()).toEqual(before);
 const back=await work.saveCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:2,idempotencyKey:'back',content:d.content}),next=await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:back.draftRevision});expect(next).not.toEqual(first);expect(next).toMatchObject({kind:'preview',draftRevision:3});
});
it('copy_invalid_draft_remains_unvalidated and reapply CAS requires the comparison latest head',async()=>{
 const f=await correctionFixture(),editor=await correction.prepareCorrectionEditor(f.deps,f.scopeId,f.confirmed.confirmationId),d=await draft(f,{edits:[{rowId:editor.rows[0].rowId,action:'set',rawValue:'-.'}],reason:'',evidenceNote:''}),ref={kind:'draft' as const,id:d.draftId};await work.closeCorrectionWork(f.deps,f.scopeId,{ref,expectedDraftRevision:1,idempotencyKey:'close'});
 const copy=await work.copyClosedCorrectionWork(f.deps,f.scopeId,{ref,idempotencyKey:'copy-invalid'});if('kind' in copy)throw Error('draft');
 const detail=await work.getCorrectionReviewDetail(f.r,f.scopeId,{kind:'draft',id:copy.draftId});expect(detail.rows[0].proposedText).toBe('-.');expect(detail.summary.validChangeCount).toBeNull();
 await expect(work.reapplyCorrectionDraft(f.deps,f.scopeId,{draftId:copy.draftId,expectedDraftRevision:1,expectedLatestConfirmationId:'wrong',idempotencyKey:'stale'})).rejects.toMatchObject({code:'STALE_BASE'});
 const reapply=await work.reapplyCorrectionDraft(f.deps,f.scopeId,{draftId:copy.draftId,expectedDraftRevision:1,expectedLatestConfirmationId:f.confirmed.confirmationId,idempotencyKey:'reapply'});if('kind' in reapply)throw Error('draft');expect(reapply.content.edits[0].rawValue).toBe('-.');expect(await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:copy.draftId,expectedDraftRevision:2})).toMatchObject({kind:'invalid'});
});
it('copy_all_equal_is_no_change; successful receipt wins before later head, mapping or new IDs',async()=>{
 const f=await correctionFixture(),d=await draft(f),ref={kind:'draft' as const,id:d.draftId};await work.closeCorrectionWork(f.deps,f.scopeId,{ref,expectedDraftRevision:1,idempotencyKey:'close'});
 const other=await draft(f),p=await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:other.draftId,expectedDraftRevision:1});if(p.kind!=='preview')throw Error('preview');await correction.confirmCorrection(f.deps,f.scopeId,{...p,expectedBaseRevision:1,idempotencyKey:'confirm',reason:other.content.reason});
 const before=f.counts();expect(await work.copyClosedCorrectionWork(f.deps,f.scopeId,{ref,idempotencyKey:'copy-equal'})).toEqual({kind:'no-change'});expect(f.counts()).toEqual(before);
 const stored=await f.r.getCandidate(f.scopeId,(await f.r.getCorrectionPreview(f.scopeId,p.previewId))!.candidateId),next=await f.r.putCandidate({...stored!,correctionPreviewId:null,document:{...stored!.document,contentHash:'after-no-change'}});await f.r.commitConfirmation(f.scopeId,{candidateId:next.candidateId,expectedRevision:2,idempotencyKey:'later',correctionReason:'합성'});
 expect(await work.copyClosedCorrectionWork({...f.deps,nextId:()=>{throw Error('NEW_ID');}},f.scopeId,{ref,idempotencyKey:'copy-equal'})).toEqual({kind:'no-change'});
 await expect(work.copyClosedCorrectionWork(f.deps,f.scopeId,{ref:{kind:'draft',id:other.draftId},idempotencyKey:'copy-equal'})).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_REUSED'});
});
it('copy_rejects_unmapped_or_changed_semantic_rows',async()=>{
 const f=await correctionFixture(),d=await draft(f),ref={kind:'draft' as const,id:d.draftId};await work.closeCorrectionWork(f.deps,f.scopeId,{ref,expectedDraftRevision:1,idempotencyKey:'close'});
 const stored=await f.r.getCorrectionBasis(f.scopeId,d.editor.basisId),changed={...stored!,basisId:crypto.randomUUID(),rows:stored!.rows.map(row=>row.rowId===d.content.edits[0].rowId?{...row,unit:'changed'}:row)};await f.r.putCorrectionBasis(changed);
 const proxy=new Proxy(f.r,{get(t,k){if(k==='getCorrectionBasis')return async(s:string,id:string)=>id===d.editor.basisId?changed:t.getCorrectionBasis(s,id);const value=Reflect.get(t,k);return typeof value==='function'?value.bind(t):value;}});
 await expect(work.copyClosedCorrectionWork({...f.deps,repository:proxy},f.scopeId,{ref,idempotencyKey:'mapping'})).rejects.toMatchObject({code:'INVALID_DRAFT'});
});
it('closing an unapplied copy then copying again preserves the original baseline and proposal',async()=>{
 const f=await correctionFixture(),d=await draft(f),ref={kind:'draft' as const,id:d.draftId};await work.closeCorrectionWork(f.deps,f.scopeId,{ref,expectedDraftRevision:1,idempotencyKey:'close'});
 const copy=await work.copyClosedCorrectionWork(f.deps,f.scopeId,{ref,idempotencyKey:'copy'});if('kind' in copy)throw Error('draft');const copiedRef={kind:'draft' as const,id:copy.draftId};await work.closeCorrectionWork(f.deps,f.scopeId,{ref:copiedRef,expectedDraftRevision:1,idempotencyKey:'close-copy'});
 const second=await work.copyClosedCorrectionWork(f.deps,f.scopeId,{ref:copiedRef,idempotencyKey:'second-copy'});if('kind' in second)throw Error('draft');const detail=await work.getCorrectionReviewDetail(f.r,f.scopeId,{kind:'draft',id:second.draftId});expect(detail.rows[0]).toMatchObject({originalText:'100',proposedText:'0'});expect(detail.reason).toBe(d.content.reason);
 await expect(correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:second.draftId,expectedDraftRevision:1})).rejects.toMatchObject({code:'INVALID_DRAFT'});
});
it('copy maps changed row IDs by unique full meaning; three-way detail preserves original current proposal',async()=>{
 const f=await correctionFixture(),d=await draft(f),ref={kind:'draft' as const,id:d.draftId};await work.closeCorrectionWork(f.deps,f.scopeId,{ref,expectedDraftRevision:1,idempotencyKey:'close'});
 const other=await draft(f),saved=await work.saveCorrectionDraft(f.deps,f.scopeId,{draftId:other.draftId,expectedDraftRevision:1,idempotencyKey:'other-value',content:{...other.content,edits:[{...other.content.edits[0],rawValue:'25'}]}}),p=await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:saved.draftId,expectedDraftRevision:2});if(p.kind!=='preview')throw Error('preview');const committed=await correction.confirmCorrection(f.deps,f.scopeId,{...p,expectedBaseRevision:1,idempotencyKey:'confirm-other',reason:saved.content.reason});if(committed.kind!=='confirmed')throw Error('confirm');
 const proxy=new Proxy(f.r,{get(t,k){if(k==='putCorrectionBasis')return (basis:import('../../application/report-history/ports').CorrectionBasis)=>t.putCorrectionBasis({...basis,rows:basis.rows.map(row=>({...row,rowId:'new-'+row.rowId}))});const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}}),deps={...f.deps,repository:proxy};
 const copied=await work.copyClosedCorrectionWork(deps,f.scopeId,{ref,idempotencyKey:'semantic-copy'});if('kind' in copied)throw Error('copy');const detail=await work.getCorrectionReviewDetail(f.r,f.scopeId,{kind:'draft',id:copied.draftId});expect(detail.rows[0]).toMatchObject({originalText:'100',proposedText:'0',current:{originalText:'25'}});
 const applied=await work.reapplyCorrectionDraft(deps,f.scopeId,{draftId:copied.draftId,expectedDraftRevision:1,expectedLatestConfirmationId:committed.confirmationId,idempotencyKey:'semantic-reapply'});if('kind' in applied)throw Error('draft');expect(applied.content.edits[0].rowId).toBe('new-'+d.content.edits[0].rowId);
 expect(await correction.previewCorrectionDraft(deps,f.scopeId,{draftId:applied.draftId,expectedDraftRevision:2})).toMatchObject({kind:'preview'});
});
it('copy rejects ambiguous meanings and protected rows',async()=>{
 for(const mode of ['ambiguous','protected'] as const){
 const f=await correctionFixture(),d=await draft(f),ref={kind:'draft' as const,id:d.draftId};await work.closeCorrectionWork(f.deps,f.scopeId,{ref,expectedDraftRevision:1,idempotencyKey:'close'});
 const proxy=new Proxy(f.r,{get(t,k){if(k==='putCorrectionBasis')return (basis:import('../../application/report-history/ports').CorrectionBasis)=>{const row=basis.rows.find(r=>r.rowId===d.content.edits[0].rowId)!;return t.putCorrectionBasis({...basis,rows:mode==='ambiguous'?[...basis.rows,{...row,rowId:'duplicate'}]:basis.rows.map(r=>r.rowId===row.rowId?{...r,allowedActions:[]}:r)});};const value=Reflect.get(t,k);return typeof value==='function'?value.bind(t):value;}});
 await expect(work.copyClosedCorrectionWork({...f.deps,repository:proxy},f.scopeId,{ref,idempotencyKey:'invalid-copy'})).rejects.toMatchObject({code:'INVALID_DRAFT'});
 }
});
it.each([{noFetchedAt:true},{future:true}])('web replay retains stored fallback/future Clock semantics %j',async options=>{
 const f=await correctionFixture(options),d=await draft(f),result=await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:1});if(result.kind!=='preview')throw Error('preview');const p=await f.r.getCorrectionPreview(f.scopeId,result.previewId),next=await f.r.getCandidate(f.scopeId,p!.candidateId),old=await f.r.getCandidate(f.scopeId,f.candidate.candidateId);
 for(const indicator of ['construction','funding'] as const){const a=await f.r.getCalculation(f.scopeId,old!.calculationIds[indicator]),b=await f.r.getCalculation(f.scopeId,next!.calculationIds[indicator]);expect(b!.resultJson).toEqual(a!.resultJson);expect(b!.evaluationClockTrace).toEqual(a!.evaluationClockTrace);}
 expect(f.calls()).toBe(0);
});
it('web changes independent incomeTotal and stored ECOS value/missing without recomputing a cash sum',async()=>{
 const f=await correctionFixture(),editor=await correction.prepareCorrectionEditor(f.deps,f.scopeId,f.confirmed.confirmationId),income=editor.rows.find(r=>r.category==='cashflow'&&r.label==='수입계')!,economic=editor.rows.find(r=>r.category==='economic')!;
 const d=await draft(f,{edits:[{rowId:income.rowId,action:'set',rawValue:'1.0000000000000002'},{rowId:economic.rowId,action:'set-missing',rawValue:null}],reason:'합성 원자료 정정',evidenceNote:'공표 근거'}),result=await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:d.draftId,expectedDraftRevision:1});if(result.kind!=='preview')throw Error('preview');
 const p=await f.r.getCorrectionPreview(f.scopeId,result.previewId),input=await f.r.getInputSnapshot(f.scopeId,p!.inputSnapshotId),candidate=await f.r.getCandidate(f.scopeId,p!.candidateId),calculation=await f.r.getCalculation(f.scopeId,candidate!.calculationIds.construction),evidence=await f.r.getEvidence(f.scopeId,calculation!.captureIds[0]);
 expect((input!.statements[0].amounts.수입계 as readonly number[])[0]).toBe(1.0000000000000002);expect((input!.statements[0].amounts.수입 as readonly number[])[0]).toBe(40);
 const stored=f.deps.decode!<{value:Record<string,{values:Map<string,number>}>}>(evidence!.payloadJson);expect(stored.value[economic.label].values.has(economic.period)).toBe(false);expect(stored.value[economic.label].values.get('2026/06')).toBe(100);expect(f.calls()).toBe(0);
});
it('reapply whole-equal returns receipt-only no-change and retries before newer draft/head state',async()=>{
 const f=await correctionFixture(),d=await draft(f),ref={kind:'draft' as const,id:d.draftId};await work.closeCorrectionWork(f.deps,f.scopeId,{ref,expectedDraftRevision:1,idempotencyKey:'close'});const copy=await work.copyClosedCorrectionWork(f.deps,f.scopeId,{ref,idempotencyKey:'copy'});if('kind' in copy)throw Error('draft');
 const other=await draft(f),preview=await correction.previewCorrectionDraft(f.deps,f.scopeId,{draftId:other.draftId,expectedDraftRevision:1});if(preview.kind!=='preview')throw Error('preview');const confirmed=await correction.confirmCorrection(f.deps,f.scopeId,{...preview,expectedBaseRevision:1,idempotencyKey:'confirm',reason:other.content.reason});if(confirmed.kind!=='confirmed')throw Error('confirmed');
 const cmd={draftId:copy.draftId,expectedDraftRevision:1,expectedLatestConfirmationId:confirmed.confirmationId,idempotencyKey:'reapply-equal'},before=f.counts();expect(await work.reapplyCorrectionDraft(f.deps,f.scopeId,cmd)).toEqual({kind:'no-change'});expect(f.counts()).toEqual(before);
 await work.closeCorrectionWork(f.deps,f.scopeId,{ref:{kind:'draft',id:copy.draftId},expectedDraftRevision:1,idempotencyKey:'close-copied'});
 expect(await work.reapplyCorrectionDraft({...f.deps,nextId:()=>{throw Error('NEW_ID');}},f.scopeId,cmd)).toEqual({kind:'no-change'});
});
