import type { JsonValue, ReportBasis } from './report-history';

export type CorrectionAction = 'set' | 'set-missing';
export type CorrectionEditorRow = {
  readonly rowId: string;
  readonly category: 'cashflow' | 'economic' | 'funding';
  readonly label: string;
  readonly sourceRound: string;
  readonly period: string;
  readonly unit: string;
  readonly originalText: string;
  readonly originalState: 'available' | 'missing' | 'unreadable';
  readonly allowedActions: readonly CorrectionAction[];
};
/** Stable source meaning excludes capture IDs, array offsets, and presentation row IDs. */
export type CorrectionSourceIdentity =
  | { readonly kind: 'statement'; readonly asOf: { readonly year: number; readonly month: number; readonly day: number }; readonly item: string }
  | { readonly kind: 'ecos'; readonly indicator: string; readonly statistic: string; readonly items: readonly string[] }
  | { readonly kind: 'kofia'; readonly bond: 'publicAaa' | 'treasury'; readonly maturity: string; readonly measure: 'published-three-agency-average' };
export type CorrectionBasisRow = CorrectionEditorRow & {
  readonly sourceRecordId: string;
  readonly fieldPath: string;
  readonly sourceIdentity: CorrectionSourceIdentity;
  readonly originalValue: number | null;
};
export type CorrectionBasis = {
  readonly recordKind: 'correction-basis';
  readonly payloadVersion: 2;
  readonly basisId: string;
  readonly scopeId: string;
  readonly baseConfirmationId: string;
  readonly baseRevision: number;
  readonly baseDocumentHash: string;
  readonly basis: ReportBasis;
  readonly inputSnapshotId: string;
  readonly inputHash: string;
  readonly calculationIds: { readonly construction: string; readonly funding: string };
  readonly historySelectionId: string;
  readonly calculationVersion: string;
  readonly templateVersion: string;
  readonly createdAt: string;
  readonly rows: readonly CorrectionBasisRow[];
};
export type CorrectionEditorDto = Pick<CorrectionBasis, 'basisId' | 'baseConfirmationId' | 'baseRevision' | 'basis'> & { readonly rows: readonly CorrectionEditorRow[] };
export type CorrectionEdit = { readonly rowId: string; readonly action: CorrectionAction; readonly rawValue: string | null; readonly evidenceNote: string };
export type CorrectionEditRequest = { readonly basisId: string; readonly reason: string; readonly edits: readonly CorrectionEdit[] };
export type CorrectionFieldError = { readonly rowId: string | null; readonly field: 'request' | 'action' | 'value' | 'reason' | 'evidenceNote'; readonly code: string; readonly message: string };
export type NormalizedCorrectionPatch = readonly { readonly rowId: string; readonly action: CorrectionAction; readonly value: number | null; readonly reason: string; readonly evidenceNote: string }[];
export type CorrectionValidation = { readonly kind: 'invalid'; readonly errors: readonly CorrectionFieldError[] } | { readonly kind: 'no-change' } | { readonly kind: 'valid'; readonly patch: NormalizedCorrectionPatch; readonly reason: string };
export type DraftEdit = Pick<CorrectionEdit, 'rowId' | 'action' | 'rawValue'>;
export type DraftContent = { readonly edits: readonly DraftEdit[]; readonly reason: string; readonly evidenceNote: string };
export type SaveDraftCommand = { readonly draftId: string; readonly expectedDraftRevision: number; readonly idempotencyKey: string; readonly content: DraftContent };
export type CorrectionDraftDto = { readonly draftId: string; readonly draftRevision: number; readonly editor: CorrectionEditorDto; readonly content: DraftContent; readonly createdAt: string; readonly savedAt: string; readonly currentPreviewId: string | null; readonly requiresReapply: boolean };
export type CorrectionWorkRef = { readonly kind: 'draft' | 'legacy-preview'; readonly id: string };
export type CorrectionWorkState = 'draft' | 'pending' | 'stale' | 'confirmed' | 'closed' | 'reflected';
export type CorrectionWorkSummary = {
  readonly ref: CorrectionWorkRef;
  readonly state: CorrectionWorkState;
  readonly reportCycle: string;
  readonly reportTitleMonth: string;
  readonly baseRevision: number;
  readonly createdAt: string;
  readonly savedAt: string;
  readonly summary: string;
  readonly inputCount: number;
  readonly validChangeCount: number | null;
  readonly capabilities: { readonly resume: boolean; readonly view: boolean; readonly copy: boolean; readonly close: boolean };
};
export type CorrectionReviewRow = CorrectionEditorRow & {
  readonly proposedAction: CorrectionAction;
  readonly proposedText: string | null;
  readonly evidenceNote: string;
  /** Current values are comparison-only; originalText always belongs to the saved work. */
  readonly current: Pick<CorrectionEditorRow, 'originalText' | 'originalState'> | null;
};
export type CorrectionReviewDetail = {
  readonly summary: CorrectionWorkSummary;
  readonly rows: readonly CorrectionReviewRow[];
  readonly reason: string;
  readonly evidenceNote: string;
  readonly preview: { readonly previewId: string; readonly previewHash: string; readonly draftRevision: number | null } | null;
  readonly confirmationId: string | null;
  readonly resolvedAt: string | null;
};
export type CorrectionMonthSummary = {
  readonly reportCycle: string;
  readonly reportTitleMonth: string;
  readonly latestConfirmationId: string;
  readonly latestRevision: number;
  readonly confirmedAt: string;
  readonly pendingCount: number;
  readonly draftCount: number;
  readonly resumeRef: CorrectionWorkRef | null;
};
export type CorrectionEditResult = { readonly kind: 'invalid'; readonly errors: readonly CorrectionFieldError[] } | { readonly kind: 'no-change' } | { readonly kind: 'preview'; readonly previewId: string; readonly previewHash: string; readonly draftRevision: number };
export type CorrectionResolutionKind = 'closed' | 'reflected';
export type CorrectionResolution = {
  readonly resolutionId: string;
  readonly scopeId: string;
  readonly ref: CorrectionWorkRef;
  readonly kind: CorrectionResolutionKind;
  readonly resolvedAt: string;
  readonly preservedContentRef: string;
  readonly reflectedConfirmationId: string | null;
};
export type CorrectionDraft = {
  readonly draftId: string;
  readonly scopeId: string;
  readonly reportCycle: string;
  readonly basisId: string;
  readonly draftRevision: number;
  readonly content: DraftContent;
  readonly createdAt: string;
  readonly savedAt: string;
  readonly currentPreviewId: string | null;
  readonly requiresReapply: boolean;
  readonly copiedFrom: CorrectionWorkRef | null;
  readonly originalBasisId: string | null;
  readonly proposedContent: DraftContent | null;
};
export type CorrectionWorkCommand = {
  readonly scopeId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly action: 'create' | 'save' | 'copy' | 'close' | 'reapply';
  readonly acknowledgedAt: string;
  readonly acknowledgement: JsonValue;
};

/** Strings use ordinary decimal syntax; exponent notation is opt-in for typed legacy XLSX cells. */
export function parseCorrectionDecimal(raw: string, options: { readonly allowExponent?: boolean } = {}): number | null {
  const grammar = options.allowExponent ? /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/ : /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;
  if (!grammar.test(raw)) return null;
  const value = Number(raw);
  return !Number.isFinite(value) || (value === 0 && /[1-9]/.test(raw.split(/[eE]/)[0])) ? null : value;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const boundedText = (value: unknown): value is string => typeof value === 'string' && value.length <= 2000;
const fieldError = (rowId: string | null, field: CorrectionFieldError['field'], code: string): CorrectionFieldError => ({ rowId, field, code, message: ({ INVALID_NUMBER: '유한한 일반 십진수를 입력하세요.', REQUIRED_REASON: '사유를 입력하세요.', ROW_MISMATCH: '행 식별자가 기준 기록과 다릅니다.', DUPLICATE_ROW: '같은 행은 한 번만 입력하세요.', INVALID_ACTION: '허용된 동작을 선택하세요.', LIMIT_EXCEEDED: '입력 길이 또는 행 수 상한을 확인하세요.', INCOMPLETE_REPAIR: '판독불가 항목의 모든 기존 월 값을 입력하세요.' } as Record<string, string>)[code] ?? '입력 형식을 확인하세요.' });

/** Shared row business rules. Transport adapters choose blank and numeric-cell syntax only. */
export function normalizeCorrectionRowEdit(
  row: { readonly originalValue: number | null; readonly originalState?: CorrectionEditorRow['originalState']; readonly allowedActions: readonly string[] },
  edit: CorrectionEdit,
  reason: string,
  options: { readonly allowExponent?: boolean; readonly blankMeansUnchanged?: boolean } = {},
): { readonly kind: 'valid'; readonly edit: NormalizedCorrectionPatch[number] } | { readonly kind: 'no-change' } | { readonly kind: 'invalid'; readonly errors: readonly CorrectionFieldError[] } {
  if (!row.allowedActions.includes(edit.action)) return { kind: 'invalid', errors: [fieldError(edit.rowId, 'action', 'INVALID_ACTION')] };
  const errors: CorrectionFieldError[] = [];
  if (!boundedText(reason)) errors.push(fieldError(edit.rowId, 'reason', 'LIMIT_EXCEEDED'));
  else if (!reason.trim()) errors.push(fieldError(edit.rowId, 'reason', 'REQUIRED_REASON'));
  if (!boundedText(edit.evidenceNote)) errors.push(fieldError(edit.rowId, 'evidenceNote', 'LIMIT_EXCEEDED'));
  const blank = edit.action === 'set' && edit.rawValue === '' && options.blankMeansUnchanged;
  const value = edit.action === 'set-missing' || blank ? null : typeof edit.rawValue === 'string' ? parseCorrectionDecimal(edit.rawValue, options) : null;
  if ((edit.action === 'set' && value === null && !blank) || (edit.action === 'set-missing' && edit.rawValue !== null && edit.rawValue !== '')) errors.push(fieldError(edit.rowId, 'value', 'INVALID_NUMBER'));
  if (errors.length) return { kind: 'invalid', errors };
  return blank || (row.originalState !== 'unreadable' && value === row.originalValue) ? { kind: 'no-change' }
    : { kind: 'valid', edit: { rowId: edit.rowId, action: edit.action, value, reason: reason.trim(), evidenceNote: edit.evidenceNote.trim() } };
}

function validateEdits(basis: CorrectionBasis, edits: unknown, withEvidence: boolean): CorrectionFieldError[] {
  if (!Array.isArray(edits) || edits.length > 10000) return [fieldError(null, 'request', 'LIMIT_EXCEEDED')];
  const errors: CorrectionFieldError[] = [], seen = new Set<string>();
  const rows = new Map(basis.rows.map(row => [row.rowId, row]));
  for (const edit of edits) {
    if (!object(edit) || !keys(edit, withEvidence ? ['rowId', 'action', 'rawValue', 'evidenceNote'] : ['rowId', 'action', 'rawValue'])) {
      errors.push(fieldError(null, 'request', 'INVALID_REQUEST')); continue;
    }
    const id = typeof edit.rowId === 'string' ? edit.rowId : null;
    if (!boundedText(id) || !id || !rows.has(id)) { errors.push(fieldError(id, 'request', 'ROW_MISMATCH')); continue; }
    if (seen.has(id)) errors.push(fieldError(id, 'request', 'DUPLICATE_ROW'));
    seen.add(id);
    if ((edit.action !== 'set' && edit.action !== 'set-missing') || !rows.get(id)!.allowedActions.includes(edit.action)) errors.push(fieldError(id, 'action', 'INVALID_ACTION'));
    if ((edit.rawValue !== null && !boundedText(edit.rawValue)) || (edit.action === 'set' && edit.rawValue === null) || (edit.action === 'set-missing' && edit.rawValue !== null && edit.rawValue !== '')) errors.push(fieldError(id, 'value', 'INVALID_VALUE'));
    if (withEvidence && !boundedText(edit.evidenceNote)) errors.push(fieldError(id, 'evidenceNote', 'LIMIT_EXCEEDED'));
  }
  return errors;
}

/** Invalid numbers and incomplete reasons remain raw, but identity/action/type/size never relax. */
export function validateDraftContent(basis: CorrectionBasis, content: DraftContent): { readonly kind: 'valid'; readonly content: DraftContent } | { readonly kind: 'invalid'; readonly errors: readonly CorrectionFieldError[] } {
  if (!object(content) || !keys(content, ['edits', 'reason', 'evidenceNote'])) return { kind: 'invalid', errors: [fieldError(null, 'request', 'INVALID_REQUEST')] };
  const errors = validateEdits(basis, content.edits, false);
  if (!boundedText(content.reason)) errors.push(fieldError(null, 'reason', 'LIMIT_EXCEEDED'));
  if (!boundedText(content.evidenceNote)) errors.push(fieldError(null, 'evidenceNote', 'LIMIT_EXCEEDED'));
  return errors.length ? { kind: 'invalid', errors } : { kind: 'valid', content };
}
export function isEmptyDraftContent(content: DraftContent): boolean {
  return content.edits.every(edit => edit.action === 'set' && edit.rawValue === '') && !content.reason.trim() && !content.evidenceNote.trim();
}

function identityParts(row: CorrectionBasisRow): readonly unknown[] {
  const source = row.sourceIdentity;
  const identity = source.kind === 'ecos' ? [source.kind, source.indicator, source.statistic, source.items]
    : source.kind === 'statement' ? [source.kind, source.asOf.year, source.asOf.month, source.asOf.day, source.item]
    : [source.kind, source.bond, source.maturity, source.measure];
  return [row.category, row.sourceRound, row.unit, ...identity];
}
const semanticKey = (row: CorrectionBasisRow): string => JSON.stringify([...identityParts(row), row.period]);

export function normalizeCorrectionEdits(basis: CorrectionBasis, request: CorrectionEditRequest): CorrectionValidation {
  if (!object(request) || !keys(request, ['basisId', 'reason', 'edits']) || request.basisId !== basis.basisId) return { kind: 'invalid', errors: [fieldError(null, 'request', 'BASIS_MISMATCH')] };
  const errors = validateEdits(basis, request.edits, true);
  if (!boundedText(request.reason)) errors.push(fieldError(null, 'reason', 'LIMIT_EXCEEDED'));
  else if (!request.reason.trim()) errors.push(fieldError(null, 'reason', 'REQUIRED_REASON'));
  if (errors.length) return { kind: 'invalid', errors };
  const patch: NormalizedCorrectionPatch[number][] = [];
  const rows = new Map(basis.rows.map(row => [row.rowId, row]));
  for (const edit of request.edits) {
    const result = normalizeCorrectionRowEdit(rows.get(edit.rowId)!, edit, request.reason, { blankMeansUnchanged: true });
    if (result.kind === 'invalid') errors.push(...result.errors);
    else if (result.kind === 'valid') patch.push(result.edit);
  }
  const changed = new Set(patch.map(edit => edit.rowId));
  const repairGroups = new Set(basis.rows.filter(row => row.originalState === 'unreadable' && changed.has(row.rowId)).map(row => JSON.stringify(identityParts(row))));
  for (const row of basis.rows) if (repairGroups.has(JSON.stringify(identityParts(row))) && !changed.has(row.rowId)) {
    errors.push(fieldError(row.rowId, 'value', 'INCOMPLETE_REPAIR')); break;
  }
  return errors.length ? { kind: 'invalid', errors } : patch.length ? { kind: 'valid', patch: patch.sort((a, b) => a.rowId.localeCompare(b.rowId)), reason: request.reason.trim() } : { kind: 'no-change' };
}

export function toCorrectionEditorDto(basis: CorrectionBasis): CorrectionEditorDto {
  return { basisId: basis.basisId, baseConfirmationId: basis.baseConfirmationId, baseRevision: basis.baseRevision, basis: { ...basis.basis }, rows: basis.rows.map(row => ({ rowId: row.rowId, category: row.category, label: row.label, sourceRound: row.sourceRound, period: row.period, unit: row.unit, originalText: row.originalText, originalState: row.originalState, allowedActions: [...row.allowedActions] })) };
}

/** All changes must uniquely match source meaning and exact numeric/missing state. */
export function correctionPatchAlreadyApplied(original: CorrectionBasis, patch: NormalizedCorrectionPatch, current: CorrectionBasis): boolean {
  if (!patch.length || original.scopeId !== current.scopeId || original.basis.reportCycle !== current.basis.reportCycle) return false;
  const seen = new Set<string>();
  const originals = new Map<string, CorrectionBasisRow[]>();
  const originalMeanings = new Map<string, number>();
  const currentMeanings = new Map<string, CorrectionBasisRow[]>();
  for (const row of original.rows) {
    originals.set(row.rowId, [...(originals.get(row.rowId) ?? []), row]);
    const meaning = semanticKey(row);
    originalMeanings.set(meaning, (originalMeanings.get(meaning) ?? 0) + 1);
  }
  for (const row of current.rows) {
    const meaning = semanticKey(row);
    currentMeanings.set(meaning, [...(currentMeanings.get(meaning) ?? []), row]);
  }
  return patch.every(edit => {
    if (seen.has(edit.rowId)) return false;
    seen.add(edit.rowId);
    const source = originals.get(edit.rowId);
    if (source?.length !== 1 || !source[0].allowedActions.includes(edit.action)) return false;
    const meaning = semanticKey(source[0]);
    if (originalMeanings.get(meaning) !== 1) return false;
    const matching = currentMeanings.get(meaning);
    if (matching?.length !== 1 || !matching[0].allowedActions.includes(edit.action)) return false;
    return edit.action === 'set' ? typeof edit.value === 'number' && Number.isFinite(edit.value) && matching[0].originalState === 'available' && matching[0].originalValue === edit.value
      : edit.value === null && matching[0].originalState === 'missing' && matching[0].originalValue === null;
  });
}
export function correctionWorkState(input: { readonly confirmationId: string | null; readonly resolutionKind: CorrectionResolutionKind | null; readonly hasPreview: boolean; readonly previewIsCurrent: boolean; readonly stale: boolean }): CorrectionWorkState {
  if (input.confirmationId) return 'confirmed';
  if (input.resolutionKind) return input.resolutionKind;
  if (input.stale) return 'stale';
  return input.hasPreview && input.previewIsCurrent ? 'pending' : 'draft';
}
