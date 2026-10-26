import { correctionPatchAlreadyApplied, correctionRowSemanticKey, normalizeCorrectionEdits, toCorrectionEditorDto, type CorrectionBasis, type CorrectionBasisRow, type CorrectionDraftDto, type CorrectionWorkRef, type DraftContent, type SaveDraftCommand } from '../../domain/report-history/correction';
import { HistoryOperationError, type CloseCorrectionWorkCommand, type CopyClosedCorrectionWorkCommand, type CorrectionDependencies, type CorrectionDraftMutationResult, type CorrectionMonthQuery, type CorrectionWorkQuery, type CreateCorrectionDraftCommand, type HistoryRepository, type ReapplyCorrectionDraftCommand, type StoredCorrectionDraft } from './ports';
import { parseYearMonth } from '../../domain/shared/year-month';
import { prepareCorrectionEditor } from './report-correction';

const fail = (code: ConstructorParameters<typeof HistoryOperationError>[0]): never => { throw new HistoryOperationError(code); };
async function dto(repository: HistoryRepository, scopeId: string, draft: StoredCorrectionDraft): Promise<CorrectionDraftDto> {
  const basis = await repository.getCorrectionBasis(scopeId,draft.basisId);
  if (!basis) return fail('NOT_FOUND');
  return {draftId:draft.draftId,draftRevision:draft.draftRevision,editor:toCorrectionEditorDto(basis),content:draft.content,createdAt:draft.createdAt,savedAt:draft.savedAt,currentPreviewId:draft.currentPreviewId,requiresReapply:draft.requiresReapply};
}
export async function createCorrectionDraft(deps: CorrectionDependencies, scopeId: string, cmd: CreateCorrectionDraftCommand): Promise<CorrectionDraftDto|'empty'> {
  const draft = await deps.repository.createCorrectionDraft(scopeId,cmd);
  return draft ? dto(deps.repository,scopeId,draft) : 'empty';
}
export async function saveCorrectionDraft(deps: CorrectionDependencies, scopeId: string, cmd: SaveDraftCommand): Promise<CorrectionDraftDto> {
  return dto(deps.repository,scopeId,await deps.repository.saveCorrectionDraft(scopeId,cmd));
}
export async function getCorrectionDraft(repository: HistoryRepository, scopeId: string, draftId: string): Promise<CorrectionDraftDto> {
  const draft = await repository.getCorrectionDraft(scopeId,draftId);
  if (!draft) return fail('NOT_FOUND');
  return dto(repository,scopeId,draft);
}
export function listCorrectionWork(repository: HistoryRepository, scopeId: string, query: CorrectionWorkQuery) { return repository.listCorrectionWork(scopeId,query); }
export function listCorrectionMonths(repository: HistoryRepository, scopeId: string, query: CorrectionMonthQuery) { return repository.listCorrectionMonths(scopeId,query); }
export async function getCorrectionReviewDetail(repository: HistoryRepository, scopeId: string, ref: CorrectionWorkRef) {
  const detail = await repository.getCorrectionReviewDetail(scopeId,ref);
  if (!detail) return fail('NOT_FOUND');
  return detail;
}
export function closeCorrectionWork(deps: CorrectionDependencies, scopeId: string, cmd: CloseCorrectionWorkCommand) { return deps.repository.closeCorrectionWork(scopeId,cmd); }

function mappedContent(original: CorrectionBasis, content: DraftContent, current: CorrectionBasis): DraftContent {
  if (original.scopeId!==current.scopeId || original.basis.reportCycle!==current.basis.reportCycle) return fail('INVALID_DRAFT');
  const originalIds = new Map<string,CorrectionBasisRow[]>(), originalMeanings = new Map<string,CorrectionBasisRow[]>(), currentMeanings = new Map<string,CorrectionBasisRow[]>();
  for (const row of original.rows) { originalIds.set(row.rowId,[...(originalIds.get(row.rowId)??[]),row]);originalMeanings.set(correctionRowSemanticKey(row),[...(originalMeanings.get(correctionRowSemanticKey(row))??[]),row]); }
  for (const row of current.rows) currentMeanings.set(correctionRowSemanticKey(row),[...(currentMeanings.get(correctionRowSemanticKey(row))??[]),row]);
  const seen = new Set<string>();
  return {...content,edits:content.edits.map(edit=>{
    const sources = originalIds.get(edit.rowId);
    if (seen.has(edit.rowId) || sources?.length!==1) return fail('INVALID_DRAFT');
    seen.add(edit.rowId);
    const source=sources[0], matches=currentMeanings.get(correctionRowSemanticKey(source));
    if (originalMeanings.get(correctionRowSemanticKey(source))?.length!==1 || matches?.length!==1 || !source.allowedActions.includes(edit.action) || !matches[0].allowedActions.includes(edit.action)) return fail('INVALID_DRAFT');
    return {...edit,rowId:matches[0].rowId};
  })};
}
function allEqual(original: CorrectionBasis, content: DraftContent, current: CorrectionBasis): boolean {
  const result = normalizeCorrectionEdits(original,{basisId:original.basisId,reason:content.reason,edits:content.edits.map(edit=>({...edit,evidenceNote:content.evidenceNote}))});
  // A proposal equal to its own baseline still needs comparison with the current values.
  const compared = mappedContent(original,content,current);
  const currentResult = normalizeCorrectionEdits(current,{basisId:current.basisId,reason:compared.reason,edits:compared.edits.map(edit=>({...edit,evidenceNote:compared.evidenceNote}))});
  return result.kind!=='invalid' && currentResult.kind==='no-change' && (result.kind==='no-change' || correctionPatchAlreadyApplied(original,result.patch,current));
}
async function previous(deps: CorrectionDependencies, scopeId: string, action:'copy'|'reapply', key:string, requestHash:string): Promise<CorrectionDraftMutationResult|null> {
  const receipt = await deps.repository.getCorrectionWorkCommand(scopeId,key);
  if (!receipt) return null;
  if (receipt.action!==action || receipt.requestHash!==requestHash) return fail('IDEMPOTENCY_KEY_REUSED');
  return receipt.acknowledgement as unknown as CorrectionDraftMutationResult;
}
async function resultDto(deps: CorrectionDependencies, scopeId:string, result:CorrectionDraftMutationResult) { return 'kind' in result ? result : dto(deps.repository,scopeId,result); }
async function latestBasis(deps: CorrectionDependencies, scopeId:string, reportCycle:string, expectedConfirmationId?:string) {
  const head = (await deps.repository.currentHeads(scopeId,[parseYearMonth(reportCycle)]))[0];
  if (!head?.confirmationId || (expectedConfirmationId && head.confirmationId!==expectedConfirmationId)) return fail('STALE_BASE');
  const editor = await prepareCorrectionEditor(deps,scopeId,head.confirmationId);
  const basis = await deps.repository.getCorrectionBasis(scopeId,editor.basisId);
  if (!basis) return fail('NOT_FOUND');
  return {head,basis};
}
export async function copyClosedCorrectionWork(deps: CorrectionDependencies, scopeId:string, cmd:CopyClosedCorrectionWorkCommand) {
  const requestHash = deps.hash({action:'copy',...cmd}), old = await previous(deps,scopeId,'copy',cmd.idempotencyKey,requestHash);
  if (old) return resultDto(deps,scopeId,old);
  const detail = await getCorrectionReviewDetail(deps.repository,scopeId,cmd.ref);
  if (detail.summary.state!=='closed') return fail('WORK_CLOSED');
  const source = cmd.ref.kind==='draft' ? await deps.repository.getCorrectionDraft(scopeId,cmd.ref.id) : null;
  const preview = cmd.ref.kind==='legacy-preview' ? await deps.repository.getCorrectionPreview(scopeId,cmd.ref.id) : null;
  const basisId = source?.basisId ?? (preview && ('basisId' in preview ? preview.basisId : preview.exportId));
  const original = basisId ? await deps.repository.getCorrectionBasis(scopeId,source?.requiresReapply ? source.originalBasisId! : basisId) : null;
  if (!original) return fail('NOT_FOUND');
  const content = source ? (source.requiresReapply ? source.proposedContent! : source.content) : {edits:detail.rows.map(row=>({rowId:row.rowId,action:row.proposedAction,rawValue:row.proposedText})),reason:detail.reason,evidenceNote:detail.evidenceNote};
  const {head,basis} = await latestBasis(deps,scopeId,detail.summary.reportCycle);
  mappedContent(original,content,basis);
  if (allEqual(original,content,basis)) return resultDto(deps,scopeId,await deps.repository.completeCorrectionWorkCommand({scopeId,action:'copy',idempotencyKey:cmd.idempotencyKey,requestHash,expectedHead:head,ref:cmd.ref,expectedDraftRevision:null}));
  const at=deps.metadataClock().toISOString();
  const copied:StoredCorrectionDraft={draftId:deps.nextId(),scopeId,reportCycle:basis.basis.reportCycle,basisId:basis.basisId,draftRevision:1,content:{edits:[],reason:'',evidenceNote:''},createdAt:at,savedAt:at,currentPreviewId:null,requiresReapply:true,copiedFrom:cmd.ref,originalBasisId:original.basisId,proposedContent:content};
  return resultDto(deps,scopeId,await deps.repository.writeCorrectionDraft({draft:copied,expectedDraftRevision:null,expectedHead:head,command:{action:'copy',idempotencyKey:cmd.idempotencyKey,requestHash}}));
}
export async function reapplyCorrectionDraft(deps:CorrectionDependencies,scopeId:string,cmd:ReapplyCorrectionDraftCommand) {
  const requestHash=deps.hash({action:'reapply',...cmd}),old=await previous(deps,scopeId,'reapply',cmd.idempotencyKey,requestHash);
  if(old)return resultDto(deps,scopeId,old);
  const draft=await deps.repository.getCorrectionDraft(scopeId,cmd.draftId);
  if(!draft)return fail('NOT_FOUND');
  const detail=await getCorrectionReviewDetail(deps.repository,scopeId,{kind:'draft',id:draft.draftId});
  if(['closed','reflected','confirmed'].includes(detail.summary.state))return fail('WORK_CLOSED');
  if(draft.draftRevision!==cmd.expectedDraftRevision)return fail('STALE_DRAFT');
  if(!draft.requiresReapply || !draft.originalBasisId || !draft.proposedContent)return fail('INVALID_DRAFT');
  const original=await deps.repository.getCorrectionBasis(scopeId,draft.originalBasisId);
  if(!original)return fail('NOT_FOUND');
  const {head,basis}=await latestBasis(deps,scopeId,draft.reportCycle,cmd.expectedLatestConfirmationId);
  const content=mappedContent(original,draft.proposedContent,basis);
  if(allEqual(original,draft.proposedContent,basis))return resultDto(deps,scopeId,await deps.repository.completeCorrectionWorkCommand({scopeId,action:'reapply',idempotencyKey:cmd.idempotencyKey,requestHash,expectedHead:head,ref:{kind:'draft',id:draft.draftId},expectedDraftRevision:cmd.expectedDraftRevision}));
  return resultDto(deps,scopeId,await deps.repository.writeCorrectionDraft({draft:{...draft,basisId:basis.basisId,draftRevision:draft.draftRevision+1,content,currentPreviewId:null,requiresReapply:false,savedAt:deps.metadataClock().toISOString()},expectedDraftRevision:cmd.expectedDraftRevision,expectedHead:head,command:{action:'reapply',idempotencyKey:cmd.idempotencyKey,requestHash}}));
}
