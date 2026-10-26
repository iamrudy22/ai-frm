import { expect, it, vi } from 'vitest';
import type { CorrectionBasis, CorrectionDependencies, HistoryRepository, StoredCorrectionDraft } from './ports';
import { yearMonth } from '../../domain/shared/year-month';
import * as work from './correction-work';

const scopeId='synthetic-scope';
const basis:CorrectionBasis={recordKind:'correction-basis',payloadVersion:2,basisId:'basis',scopeId,baseConfirmationId:'confirmed',baseRevision:1,baseDocumentHash:'synthetic-document',basis:{reportCycle:yearMonth(2026,9),reportTitleMonth:yearMonth(2026,8),constructionBaseMonth:yearMonth(2026,7),fundingJudgedMonth:yearMonth(2026,9),fundingObservedMonth:yearMonth(2026,8),gapMonth:yearMonth(2026,9)},inputSnapshotId:'input',inputHash:'input-hash',calculationIds:{construction:'construction',funding:'funding'},historySelectionId:'selection',calculationVersion:'synthetic-version',templateVersion:'synthetic-template',createdAt:'2026-10-23T00:00:00.000Z',rows:[{rowId:'cash',category:'cashflow',label:'수입계',sourceRound:'2026/09',period:'2026/09',unit:'억원',originalText:'50',originalState:'available',allowedActions:['set'],sourceRecordId:'input',fieldPath:'server-only',sourceIdentity:{kind:'statement',asOf:{year:2026,month:9,day:28},item:'수입계'},originalValue:50}]};
const draft:StoredCorrectionDraft={draftId:'draft',scopeId,reportCycle:basis.basis.reportCycle,basisId:basis.basisId,draftRevision:2,content:{edits:[{rowId:'cash',action:'set',rawValue:'-'}],reason:'',evidenceNote:''},createdAt:basis.createdAt,savedAt:basis.createdAt,currentPreviewId:null,requiresReapply:false,copiedFrom:null,originalBasisId:null,proposedContent:null};
function deps(repository:Partial<HistoryRepository>):CorrectionDependencies {return {repository,hash:(value:unknown)=>JSON.stringify(value)} as CorrectionDependencies;}

it('create/save project the acknowledged raw revision and never manufacture a new draft identity',async()=>{
 const create=vi.fn(async()=>draft),save=vi.fn(async()=>draft),getBasis=vi.fn(async()=>basis),d=deps({createCorrectionDraft:create,saveCorrectionDraft:save,getCorrectionBasis:getBasis});
 const command={basisId:basis.basisId,idempotencyKey:'create',content:draft.content};
 const created=await work.createCorrectionDraft(d,scopeId,command);expect(create).toHaveBeenCalledWith(scopeId,command);expect(created).toMatchObject({draftId:'draft',draftRevision:2,content:draft.content});
 const saved=await work.saveCorrectionDraft(d,scopeId,{draftId:'draft',expectedDraftRevision:1,idempotencyKey:'save',content:draft.content});expect(saved).toEqual(created);expect(saved.editor.rows[0]).not.toHaveProperty('sourceRecordId');expect(saved.editor.rows[0]).not.toHaveProperty('fieldPath');expect(saved.editor.rows[0]).not.toHaveProperty('sourceIdentity');
});
it('empty create ACK requires no basis read and no DTO or draft allocation',async()=>{
 const d=deps({createCorrectionDraft:vi.fn(async()=>null)});expect(await work.createCorrectionDraft(d,scopeId,{basisId:basis.basisId,idempotencyKey:'empty',content:{edits:[],reason:'',evidenceNote:''}})).toBe('empty');
});
it('resume only reads the existing draft and basis; missing draft is NOT_FOUND',async()=>{
 const read=vi.fn(async()=>draft),d=deps({getCorrectionDraft:read,getCorrectionBasis:async()=>basis});expect(await work.getCorrectionDraft(d.repository,scopeId,'draft')).toMatchObject({draftId:'draft',draftRevision:2,content:draft.content});expect(read).toHaveBeenCalledWith(scopeId,'draft');
 await expect(work.getCorrectionDraft(deps({getCorrectionDraft:async()=>null}).repository,scopeId,'missing')).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('list/month/detail are read-only projections and preserve caller ranges, cursor and stored baseline',async()=>{
 const list=vi.fn(async()=>({items:[],nextCursor:'next-work'})),months=vi.fn(async()=>({items:[],nextCursor:'next-month'})),detail={summary:{state:'closed'},rows:[{originalText:'50',proposedText:'-'}]} as unknown as Awaited<ReturnType<HistoryRepository['getCorrectionReviewDetail']>>;
 const repository=deps({listCorrectionWork:list,listCorrectionMonths:months,getCorrectionReviewDetail:async()=>detail}).repository,query={pendingOnly:true,limit:20 as const,cursor:'work-cursor'},monthQuery={pendingOnly:false,limit:12 as const,fromCycle:'2026/01',toCycle:'2026/12'};
 expect(await work.listCorrectionWork(repository,scopeId,query)).toEqual({items:[],nextCursor:'next-work'});expect(list).toHaveBeenCalledWith(scopeId,query);
 expect(await work.listCorrectionMonths(repository,scopeId,monthQuery)).toEqual({items:[],nextCursor:'next-month'});expect(months).toHaveBeenCalledWith(scopeId,monthQuery);
 expect(await work.getCorrectionReviewDetail(repository,scopeId,{kind:'draft',id:'draft'})).toBe(detail);
});
it('close forwards exact CAS/idempotency command; storage failures remain failures',async()=>{
 const command={ref:{kind:'draft' as const,id:'draft'},expectedDraftRevision:2,idempotencyKey:'close'},close=vi.fn(async()=>{throw Error('SYNTHETIC_STORAGE_FAILURE');});await expect(work.closeCorrectionWork(deps({closeCorrectionWork:close}),scopeId,command)).rejects.toThrow('SYNTHETIC_STORAGE_FAILURE');expect(close).toHaveBeenCalledWith(scopeId,command);
});
it.each(['copy','reapply'] as const)('%s returns an original no-change receipt before looking at newer heads/work',async action=>{
 const command=action==='copy'?{ref:{kind:'draft' as const,id:'closed'},idempotencyKey:'retry'}:{draftId:'draft',expectedDraftRevision:1,expectedLatestConfirmationId:'old-head',idempotencyKey:'retry'};
 const requestHash=JSON.stringify({action,...command}),d=deps({getCorrectionWorkCommand:async()=>({scopeId,idempotencyKey:'retry',action,requestHash,acknowledgedAt:basis.createdAt,acknowledgement:{kind:'no-change'}})});
 const result=action==='copy'?await work.copyClosedCorrectionWork(d,scopeId,command as Parameters<typeof work.copyClosedCorrectionWork>[2]):await work.reapplyCorrectionDraft(d,scopeId,command as Parameters<typeof work.reapplyCorrectionDraft>[2]);expect(result).toEqual({kind:'no-change'});
});
it('receipt request mismatch is rejected before reading any work or allocating a basis',async()=>{
 const d=deps({getCorrectionWorkCommand:async()=>({scopeId,idempotencyKey:'retry',action:'copy',requestHash:'different',acknowledgedAt:basis.createdAt,acknowledgement:{kind:'no-change'}})});await expect(work.copyClosedCorrectionWork(d,scopeId,{ref:{kind:'draft',id:'closed'},idempotencyKey:'retry'})).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_REUSED'});
});
