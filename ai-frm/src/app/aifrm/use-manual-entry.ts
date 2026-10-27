'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { validateManualEntryContent, type CreateManualEntryCommand, type SaveManualEntryCommand, type PrepareManualEntryCommand, type ConfirmManualEntryCommand, type ManualEntryContentV1, type ManualEntryDraftDto, type ManualEntryFieldError, type ManualEntryReviewRef, type ManualEntryInputSummary, type ManualEntrySummary } from '@/domain/report-history/manual-entry';
import type { PreparedDocument, ConfirmationResult } from '@/domain/report-history/report-history';
export class ManualEntryClientError extends Error {
 constructor(readonly status:number, readonly code:string, readonly errors:readonly ManualEntryFieldError[] = []) { super(code); }
}
const object = (v:unknown):v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v:unknown):v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const hash = (v:unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const month = (v:unknown) => typeof v === 'string' && /^\d{4}\/(0[1-9]|1[0-2])$/.test(v);
const positive = (v:unknown) => Number.isSafeInteger(v) && (v as number)>0;
function wire(condition:unknown): asserts condition { if (!condition) throw new ManualEntryClientError(0,'INVALID_RESPONSE'); }
function ref(v:unknown): v is ManualEntryReviewRef { return object(v) && uuid(v.draftId) && positive(v.draftRevision) && hash(v.rawInputHash) && uuid(v.candidateId) && hash(v.documentHash) && typeof v.preparedAt === 'string' && typeof v.evaluatedAt === 'string' && Array.isArray(v.dependencyHeads); }
function document(v:unknown): v is PreparedDocument { return object(v) && v.schemaVersion===1 && typeof v.templateVersion==='string' && hash(v.contentHash) && object(v.json) && Array.isArray(v.historyCalculationIds); }
function summary(v:unknown):v is ManualEntryInputSummary { return object(v) && ['includedRounds','omittedRounds','unavailableItems','missingEconomic','fundingDates','fundingMissing'].every(k => Array.isArray(v[k])); }
function draft(v:unknown):v is ManualEntryDraftDto {
 if (!object(v) || v.recordKind!=='manual-entry-draft' || v.payloadVersion!==1 || !uuid(v.draftId) || !positive(v.draftRevision) || !hash(v.rawInputHash) || !month(v.reportCycle) || !object(v.catalog) || !object(v.catalog.basis) || !month(v.catalog.basis.reportTitleMonth) || v.catalog.reportCycle!==v.reportCycle || !Array.isArray(v.catalog.cashflow) || !Array.isArray(v.catalog.economic) || !object(v.catalog.funding) || typeof v.savedAt!=='string' || typeof v.createdAt!=='string' || !['editing','review-ready','stale-review','month-conflict','confirmed'].includes(String(v.state))) return false;
 try { if (validateManualEntryContent(v.catalog as unknown as ManualEntryDraftDto['catalog'],v.content).kind!=='valid') return false; } catch { return false; }
 if (v.currentReview!==null && !ref(v.currentReview)) return false;
 return v.review===undefined || (object(v.review) && ref(v.review.ref) && v.review.ref.draftId===v.draftId && v.review.ref.draftRevision===v.draftRevision && v.review.ref.rawInputHash===v.rawInputHash && document(v.review.document) && v.review.document.contentHash===v.review.ref.documentHash && summary(v.review.inputSummary));
}
export function createManualEntryClient(request:typeof fetch=fetch) {
 const path='/api/report-history/manual-entries';
 async function json(url:string,body?:unknown) {
  let response:Response; let data:unknown;
  try { response=await request(url,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})}); data=await response.json(); } catch { throw new ManualEntryClientError(0,'UNKNOWN_RESPONSE'); }
  wire(object(data));
  if (!response.ok || data.ok!==true) throw new ManualEntryClientError(response.status,typeof data.code==='string'?data.code:object(data.result)&&typeof data.result.reason==='string'?data.result.reason:'UNKNOWN_RESPONSE',Array.isArray(data.errors)?data.errors as ManualEntryFieldError[]:[]);
  return data;
 }
 async function draftCommand(action:string,command:unknown) { const data=await json(path,{action,...command as object}); wire(draft(data.draft)); return data.draft; }
 return {
  create:async(cmd:CreateManualEntryCommand)=>{const ack=await draftCommand('create',cmd);wire(ack.catalog.basis.reportTitleMonth===cmd.reportTitleMonth);return ack;},
  save:async(cmd:SaveManualEntryCommand)=>{const ack=await draftCommand('save',cmd);wire(ack.draftId===cmd.draftId&&ack.draftRevision===cmd.expectedDraftRevision+1);return ack;},
  resume:async (draftId:string)=> { const data=await json(`${path}?${new URLSearchParams({draftId})}`); wire(draft(data.draft)&&data.draft.draftId===draftId); return data.draft; },
  list:async (cursor?:string):Promise<{items:readonly ManualEntrySummary[];nextCursor:string|null}>=> { const data=await json(`${path}?${new URLSearchParams({limit:'12',...(cursor?{cursor}:{})})}`); wire(Array.isArray(data.items) && data.items.every(v=>object(v)&&uuid(v.draftId)&&month(v.reportTitleMonth)&&month(v.reportCycle)&&positive(v.draftRevision)&&typeof v.savedAt==='string'&&['editing','review-ready','stale-review','month-conflict'].includes(String(v.state))) && (data.nextCursor===null || typeof data.nextCursor==='string')); return {items:data.items as ManualEntrySummary[],nextCursor:data.nextCursor as string|null}; },
  prepare:async (cmd:PrepareManualEntryCommand)=> { const data=await json(path,{action:'prepare',...cmd}); const r=data.result; wire(object(r)&&r.kind==='ready'&&ref(r.review)&&document(r.document)&&summary(r.inputSummary)&&r.review.draftId===cmd.draftId&&r.review.draftRevision===cmd.expectedDraftRevision&&r.document.contentHash===r.review.documentHash); return r as {kind:'ready';review:ManualEntryReviewRef;document:PreparedDocument;inputSummary:ManualEntryInputSummary}; },
  confirm:async (cmd:ConfirmManualEntryCommand):Promise<Extract<ConfirmationResult,{kind:'confirmed'|'already-confirmed'}>>=> { const data=await json(path,{action:'confirm',...cmd}); wire(object(data.result)&&['confirmed','already-confirmed'].includes(String(data.result.kind))&&uuid(data.result.confirmationId)&&positive(data.result.revision)); return data.result as Extract<ConfirmationResult,{kind:'confirmed'|'already-confirmed'}>; },
 };
}
export type ManualEntryClient=ReturnType<typeof createManualEntryClient>;
/** Refresh keeps the visible pending range; cursor values remain opaque server tokens. */
export async function loadManualEntryPage(client:ManualEntryClient,cursor:string|undefined,previous:readonly ManualEntrySummary[]) {
 const merge=(a:readonly ManualEntrySummary[],b:readonly ManualEntrySummary[])=>[...a,...b.filter(row=>!a.some(v=>v.draftId===row.draftId))];
 let page=await client.list(cursor);
 let items=cursor?merge(previous,page.items):[...page.items];
 if(!cursor){const seen=new Set<string>();while(page.nextCursor&&items.length<previous.length){if(seen.has(page.nextCursor))throw new ManualEntryClientError(0,'REPEATED_CURSOR');seen.add(page.nextCursor);page=await client.list(page.nextCursor);items=merge(items,page.items);}}
 return {items,nextCursor:page.nextCursor};
}
type Review=NonNullable<ManualEntryDraftDto['review']>;
export type ManualEntrySessionState={draft:ManualEntryDraftDto;content:ManualEntryContentV1;saveStatus:'saved'|'saving'|'error'|'conflict';review:Review|null;errors:readonly ManualEntryFieldError[];message:string;busy:boolean;completed:boolean;conflict:{latest:ManualEntryDraftDto|null;version:number}|null;uncertain:'prepare'|'confirm'|null};
export function manualEntryErrorMessage(error:unknown) {
 if (error instanceof ManualEntryClientError) {
  if (error.status===409) return '다른 변경과 충돌했습니다. 내 입력은 유지됩니다. 최신 내용을 조회해 확인해 주세요.';
  if (error.status===413) return '입력 분량이 너무 큽니다. 입력을 줄여 다시 저장해 주세요.';
  if (error.status===422) return '입력 항목을 확인해 주세요.';
 }
 return '요청 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.';
}
const sameRef=(a:ManualEntryReviewRef,b:ManualEntryReviewRef)=>a.draftId===b.draftId&&a.draftRevision===b.draftRevision&&a.rawInputHash===b.rawInputHash&&a.candidateId===b.candidateId&&a.documentHash===b.documentHash;
/** One instance owns one draft and one CAS queue; raw input is never replaced by a late ACK. */
export class ManualEntrySession {
 private value:ManualEntrySessionState;
 private listeners=new Set<()=>void>(); private version=0; private ackVersion=0;
 private pending:{version:number;command:SaveManualEntryCommand}|null=null;
 private running:Promise<void>|null=null; private timer:ReturnType<typeof setTimeout>|null=null; private deadline=0;
 private preparing=false;
 private prepareCommand:PrepareManualEntryCommand|null=null; private confirmCommand:ConfirmManualEntryCommand|null=null;
 constructor(draft:ManualEntryDraftDto,private client:ManualEntryClient,private nextKey:()=>string=()=>crypto.randomUUID()) {
  this.value={draft,content:draft.content,saveStatus:'saved',review:draft.state==='review-ready'&&draft.review&&draft.currentReview&&sameRef(draft.review.ref,draft.currentReview)?draft.review:null,errors:[],message:'',busy:false,completed:draft.state==='confirmed',conflict:draft.state==='month-conflict'?{latest:draft,version:0}:null,uncertain:null};
 }
 get snapshot(){return this.value;} getSnapshot=()=>this.value;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private emit(patch:Partial<ManualEntrySessionState>){this.value={...this.value,...patch};this.listeners.forEach(fn=>fn());}
 get hasUnacknowledged(){return this.version!==this.ackVersion||this.pending!==null||this.value.uncertain!==null;}
 get canConfirm(){const {review,draft}=this.value;return !!review&&review.ref.draftId===draft.draftId&&review.ref.draftRevision===draft.draftRevision&&review.ref.rawInputHash===draft.rawInputHash&&!this.pending&&this.version===this.ackVersion&&!this.value.busy&&!this.value.completed&&!this.value.conflict&&this.value.saveStatus==='saved'&&this.value.uncertain!=='prepare';}
 change(content:ManualEntryContentV1){
  if(this.value.busy||this.value.completed||this.value.uncertain==='confirm')return;
  this.version++;this.confirmCommand=null;
  this.emit({content,review:null,errors:[],message:'',conflict:this.value.conflict?{latest:null,version:this.version}:null,saveStatus:this.value.conflict?'conflict':this.value.saveStatus==='error'?'error':'saving'});
  if(this.timer)clearTimeout(this.timer);this.deadline=Date.now()+1000;
  this.timer=setTimeout(()=>{this.timer=null;if(!this.value.conflict&&this.value.saveStatus!=='error'&&!this.value.uncertain)void this.flush(false).catch(()=>{});},1000);
 }
 private async pump(force:boolean){while(this.version!==this.ackVersion||this.pending){
  if(!this.pending&&!force&&Date.now()<this.deadline)return;
  if(!this.pending)this.pending={version:this.version,command:{draftId:this.value.draft.draftId,expectedDraftRevision:this.value.draft.draftRevision,idempotencyKey:this.nextKey(),content:this.value.content}};
  const sent=this.pending;this.emit({saveStatus:'saving'});
  try{const ack=await this.client.save(sent.command);if(ack.draftId!==sent.command.draftId||ack.draftRevision!==sent.command.expectedDraftRevision+1)throw new ManualEntryClientError(0,'ACK_MISMATCH');this.pending=null;this.ackVersion=sent.version;this.emit({draft:ack,saveStatus:this.version===this.ackVersion?'saved':'saving'});}
  catch(error){if(error instanceof ManualEntryClientError&&error.status===409){this.pending=null;this.prepareCommand=null;this.confirmCommand=null;this.emit({saveStatus:'conflict',conflict:{latest:null,version:this.version},review:null,message:manualEntryErrorMessage(error)});}else{if(error instanceof ManualEntryClientError&&[422,413].includes(error.status))this.pending=null;this.emit({saveStatus:'error',errors:error instanceof ManualEntryClientError?error.errors:[],message:manualEntryErrorMessage(error)});}throw error;}
 }}
 private async flush(force:boolean):Promise<void>{if(force&&this.timer){clearTimeout(this.timer);this.timer=null;}if(this.running){await this.running;return this.flush(force);}if(this.value.conflict)throw Error('CONFLICT_REVIEW_REQUIRED');if(this.value.saveStatus==='error'||this.value.uncertain)throw Error('RETRY_REQUIRED');if(this.version===this.ackVersion&&!this.pending)return;const run=this.pump(force);this.running=run;try{await run;}finally{if(this.running===run)this.running=null;}}
 drain(){return this.flush(true);}
 async retry(){if(this.value.uncertain==='prepare')return this.prepare();if(this.value.uncertain==='confirm')return this.confirm();if(this.value.conflict)throw Error('CONFLICT_REVIEW_REQUIRED');this.emit({saveStatus:'saving',message:''});await this.drain();}
 async readConflictLatest(){if(!this.value.conflict||this.value.busy)return;const version=this.version;this.emit({busy:true,conflict:{latest:null,version}});try{const latest=await this.client.resume(this.value.draft.draftId);const verified=await this.client.resume(latest.draftId);if(verified.draftRevision!==latest.draftRevision||verified.rawInputHash!==latest.rawInputHash||version!==this.version)throw new ManualEntryClientError(409,'CONFLICT_CHANGED_DURING_READ');this.emit({conflict:{latest:verified,version},message:'서버 내용과 내 입력을 확인한 뒤 전환해 주세요.'});}catch(error){this.emit({message:manualEntryErrorMessage(error)});throw error;}finally{this.emit({busy:false});}}
 acceptConflictLatest(){const conflict=this.value.conflict;if(!conflict?.latest||conflict.version!==this.version||this.value.busy)throw Error('LATEST_COMPARISON_REQUIRED');const latest=conflict.latest;if(this.timer)clearTimeout(this.timer);this.pending=null;this.prepareCommand=null;this.confirmCommand=null;this.ackVersion=this.version;this.emit({draft:latest,content:latest.content,review:null,conflict:latest.state==='month-conflict'?{latest,version:this.version}:null,saveStatus:latest.state==='month-conflict'?'conflict':'saved',completed:latest.state==='confirmed',message:'서버의 최신 내용으로 전환했습니다.'});}
 async prepare(){let resolved=false;if(this.preparing||this.value.busy||this.value.completed||this.value.conflict||this.value.uncertain==='confirm')return;this.preparing=true;try {
  if(!this.prepareCommand){await this.drain();this.prepareCommand={draftId:this.value.draft.draftId,expectedDraftRevision:this.value.draft.draftRevision,idempotencyKey:this.nextKey()};}
  const command=this.prepareCommand;const version=this.version;this.emit({busy:true,review:null,errors:[],message:''});
  try{const ack=await this.client.prepare(command);const current=await this.client.resume(command.draftId);this.prepareCommand=null;resolved=true;this.emit({uncertain:null});
   if(version!==this.version||this.version!==this.ackVersion||current.draftId!==this.value.draft.draftId||current.draftRevision!==this.value.draft.draftRevision||current.rawInputHash!==this.value.draft.rawInputHash||current.state!=='review-ready'||!current.review||!current.currentReview||!sameRef(ack.review,current.review.ref)||!sameRef(ack.review,current.currentReview)) {this.emit({message:'현재 입력과 검토 결과가 다릅니다. 다시 검토해 주세요.'});return;}
   this.emit({draft:current,review:current.review,saveStatus:'saved',message:'산출된 보고서를 검토한 뒤 확정해 주세요.'});
  }catch(error){const definite=error instanceof ManualEntryClientError&&error.status>=400&&error.status<500&&![408,429].includes(error.status);if(definite)this.prepareCommand=null;this.emit({uncertain:definite?null:'prepare',errors:error instanceof ManualEntryClientError?error.errors:[],message:manualEntryErrorMessage(error),...(error instanceof ManualEntryClientError&&error.status===409?{conflict:{latest:null,version:this.version},saveStatus:'conflict' as const}:{})});throw error;}finally{this.emit({busy:false});}
  }finally{this.preparing=false;if(resolved&&this.version!==this.ackVersion&&!this.value.conflict)await this.drain();}
 }
 async confirm(){if(!this.canConfirm)return null;const r=this.value.review!.ref;this.confirmCommand??={draftId:r.draftId,expectedDraftRevision:r.draftRevision,candidateId:r.candidateId,documentHash:r.documentHash,expectedRevision:0,idempotencyKey:this.nextKey()};this.emit({busy:true,message:'보고서 확정 중'});
  try{const result=await this.client.confirm(this.confirmCommand);this.confirmCommand=null;this.emit({completed:true,uncertain:null,message:'보고서가 확정되었습니다.'});return result;}catch(error){const definite=error instanceof ManualEntryClientError&&error.status>=400&&error.status<500&&![408,429].includes(error.status);if(definite){this.confirmCommand=null;this.emit({review:null});}this.emit({uncertain:definite?null:'confirm',message:manualEntryErrorMessage(error),...(error instanceof ManualEntryClientError&&error.status===409?{conflict:{latest:null,version:this.version},saveStatus:'conflict' as const}:{})});throw error;}finally{this.emit({busy:false});}}
 dispose(){if(this.timer)clearTimeout(this.timer);this.timer=null;}
}
export function useManualEntry(session:ManualEntrySession){const state=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot);useEffect(()=>{const unload=(event:BeforeUnloadEvent)=>{if(session.hasUnacknowledged){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>{window.removeEventListener('beforeunload',unload);session.dispose();};},[session]);return state;}
