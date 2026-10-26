import type { ItemName, Unreadable } from '../../domain/cashflow/statement';
import type { YearMonth } from '../../domain/shared/year-month';
import type { BondYieldSource, EconomicIndicatorSource, SourceResult, YieldFetch } from '../ports';
import type { HistoryIndicator, CalculationOrigin, Derivation, JsonValue, ReportBasis, PreparedDocument, ConfirmationCommand, ConfirmationResult } from '../../domain/report-history/report-history';
export type * from '../../domain/report-history/report-history';
export type StatementSnapshotDto = {
  readonly asOf: {
    readonly year: number;
    readonly month: number;
    readonly day: number;
  };
  readonly monthLabels: readonly string[];
  readonly baseMonthIndex: number;
  readonly planYearEndIndex: number;
  readonly amounts: Readonly<Record<ItemName, readonly number[] | Unreadable>>;
};
export type EvidenceWrite = {
  readonly scopeId: string;
  readonly sourceKind: 'ecos' | 'kofia';
  readonly contentHash: string;
  readonly payloadJson: JsonValue;
  readonly schemaVersion: 1;
  readonly receivedAt: string;
  readonly derivation: Derivation;
};
export type StoredEvidence = EvidenceWrite & {
  readonly captureId: string;
};
export type InputSnapshotWrite = {
  readonly scopeId: string;
  readonly statements: readonly StatementSnapshotDto[];
  readonly sourceMetadata: JsonValue;
  readonly inputHash: string;
  readonly derivation: Derivation;
  readonly createdAt: string;
};
export type StoredInputSnapshot = InputSnapshotWrite & {
  readonly inputSnapshotId: string;
};
export type CalculationWrite = {
  readonly scopeId: string;
  readonly indicator: HistoryIndicator;
  readonly origin: CalculationOrigin;
  readonly derivation: Derivation;
  readonly effectiveMonth: YearMonth;
  readonly requestContext: JsonValue;
  readonly inputHash: string;
  readonly calculationVersion: string;
  readonly captureIds: readonly string[];
  readonly resultJson: JsonValue;
  readonly evaluatedAt: string;
  readonly evaluationClockTrace: readonly string[];
  readonly evaluatedCalendar: {
    readonly year: number;
    readonly month: number;
    readonly day: number;
  };
  readonly evaluationTimeZone: string;
  readonly createdAt: string;
  readonly batchId?: string;
};
export type StoredCalculation = CalculationWrite & {
  readonly calculationId: string;
};
export type CandidateWrite = {
  readonly scopeId: string;
  readonly basis: ReportBasis;
  readonly inputSnapshotId: string;
  readonly inputHash: string;
  readonly calculationInputHashes: { readonly construction: string; readonly funding: string };
  readonly calculationVersion: string;
  readonly authoredAt: string;
  readonly preparedAt: string;
  readonly calculationIds: {
    readonly construction: string;
    readonly funding: string;
  };
  readonly historySelectionId: string;
  readonly document: PreparedDocument;
  readonly correctionPreviewId: string | null;
};
export type StoredCandidate = CandidateWrite & {
  readonly candidateId: string;
  readonly documentHash: string;
};
export type HistoryQuery = {
  readonly scopeId: string;
  readonly indicator: HistoryIndicator;
  readonly from: YearMonth;
  readonly to: YearMonth;
  readonly calculationVersion: string;
  readonly asOf: string;
  readonly selectedBackfillBatchId: string | null;
};
export type HistorySelectionQuery = {
  readonly scopeId: string;
  readonly basis: ReportBasis;
  readonly calculationVersion: string;
  readonly asOf: string;
  readonly selectedBackfillBatchId: string | null;
};
export type RevisionToken = {
  readonly reportCycle: YearMonth;
  readonly confirmationId: string | null;
  readonly revision: number;
};
export type ExternalHistorySelection = {
  readonly historySelectionId: string;
  readonly scopeId: string;
  /** New selections carry their exact basis; older read-only selections lack it and cannot prepare a candidate. */
  readonly basis?: ReportBasis;
  readonly calculationVersion: string;
  readonly anchors: {
    readonly construction: YearMonth;
    readonly funding: YearMonth;
  };
  readonly cutoff: string;
  readonly selectedBackfillBatchId: string | null;
  readonly headRevisions: readonly RevisionToken[];
  readonly calculations: readonly StoredCalculation[];
  readonly historyCalculationIds: readonly string[];
};
export type ConfirmationSummary = {
  readonly confirmationId: string;
  readonly reportCycle: YearMonth;
  readonly revision: number;
  readonly confirmedAt: string;
  readonly candidateId: string;
  readonly correctionReason?: string;
};
export type StoredConfirmation = ConfirmationSummary & {
  readonly scopeId: string;
  readonly previousConfirmationId: string | null;
  readonly basis: ReportBasis;
  readonly canonicalCurrentCalculationIds: {
    readonly construction: string;
    readonly funding: string;
  };
  readonly historySelectionId: string;
  readonly document: PreparedDocument;
};
export type BatchWrite = {
  readonly scopeId: string;
  readonly startKey: string;
  readonly fromCycle: YearMonth;
  readonly toCycle: YearMonth;
  readonly inputHash: string;
  readonly roundEntriesJson: JsonValue;
  readonly fixedNow: string;
  readonly evaluationTimeZone: string;
  readonly evaluatedCalendar: { readonly year: number; readonly month: number; readonly day: number };
};
export type StoredBatch = BatchWrite & {
  readonly batchId: string;
  readonly completedCycles: readonly YearMonth[];
  readonly pendingCycles: readonly YearMonth[];
  readonly status: 'pending-source' | 'running' | 'completed';
};
export type BatchStepWrite = {
  readonly scopeId: string;
  readonly batchId: string;
  readonly reportCycle: YearMonth;
  readonly basis: ReportBasis;
  readonly calculationIds: {
    readonly construction: string;
    readonly funding: string;
  };
};
export type CaptureClaim = {
  readonly scopeId: string;
  readonly batchId: string;
  readonly sourceKey: string;
  readonly ownerId: string;
  readonly now: string;
  readonly leaseUntil: string;
};
export type CaptureClaimResult = {
  readonly kind: 'ready';
  readonly captureId: string;
} | {
  readonly kind: 'claimed';
  readonly fence: number;
} | {
  readonly kind: 'busy';
};
export type CaptureCompletion = Pick<CaptureClaim, 'scopeId' | 'batchId' | 'sourceKey' | 'ownerId'> & {
  readonly fence: number;
  readonly evidence: EvidenceWrite;
};
export type EditAction = 'keep' | 'set' | 'set-missing';
export type ExportRow = {
  readonly rowId: string;
  readonly sheet: '경제지표_정정' | '자금자료_정정' | '조달금리_정정';
  readonly sourceRecordId: string;
  readonly sourceKind: 'ecos' | 'statement' | 'kofia';
  readonly fieldPath: string;
  readonly identityJson: JsonValue;
  readonly unit: string;
  readonly originalValue: number | null;
  readonly allowedActions: readonly EditAction[];
  readonly protectedCells: JsonValue;
};
export type WorkbookColumn = { readonly label: string; readonly mode: 'protected' | 'editable' };
export type WorkbookSheetStructure = {
  readonly name: '안내' | '확정이력' | ExportRow['sheet'] | '_교환정보';
  readonly columns: readonly WorkbookColumn[];
  readonly rows: readonly (readonly string[])[];
  readonly protectSheet: boolean;
  readonly keyColumn: number | null;
};
export type WorkbookStructure = { readonly sheets: readonly WorkbookSheetStructure[] };
export type WorkbookExportWrite = {
  readonly scopeId: string;
  readonly exportId: string;
  readonly workbookFormatVersion: 1;
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
  readonly rows: readonly ExportRow[];
  readonly history: readonly JsonValue[];
  readonly result: JsonValue;
  readonly structure: WorkbookStructure;
};
export type StoredWorkbookExport = WorkbookExportWrite;
export type WorkbookCellError = { readonly sheet: string | null; readonly row: number | null; readonly column: string | null; readonly code: string; readonly message: string };
export type DecodedCorrection = { readonly patch: readonly { readonly rowId: string; readonly action: 'set' | 'set-missing'; readonly value: number | null; readonly reason: string; readonly evidenceNote: string }[]; readonly errors: readonly WorkbookCellError[] };
export type HistoryWorkbookCodec = {
  structure(manifest: Omit<WorkbookExportWrite, 'structure'>): WorkbookStructure;
  encode(manifest: StoredWorkbookExport): Uint8Array;
  readExportId(bytes: Uint8Array): string;
  decode(bytes: Uint8Array, manifest: StoredWorkbookExport): DecodedCorrection;
};
export type CorrectionPatch = DecodedCorrection['patch'];
export type HistoryOperationErrorCode = 'STALE_BASE' | 'STALE_DEPENDENCY' | 'STORAGE_UNAVAILABLE' | 'LIMIT_EXCEEDED' | 'NOT_FOUND' | 'UNSUPPORTED_VERSION' | 'EVALUATION_ZONE_MISMATCH';
export class HistoryOperationError extends Error {
  constructor(readonly code: HistoryOperationErrorCode) { super(code); this.name = 'HistoryOperationError'; }
}
export type WorkbookImportWrite = { readonly scopeId: string; readonly importId: string; readonly exportId: string; readonly fileHash: string; readonly patchHash: string | null; readonly patch: CorrectionPatch; readonly status: 'invalid' | 'no-change' | 'validated'; readonly errors: readonly WorkbookCellError[]; readonly receivedAt: string };
export type StoredWorkbookImport = WorkbookImportWrite;
export type CorrectionPreviewWrite = { readonly scopeId: string; readonly previewId: string; readonly previewHash: string; readonly importId: string; readonly exportId: string; readonly baseConfirmationId: string; readonly baseRevision: number; readonly inputSnapshotId: string; readonly candidateId: string; readonly dependencyHeads: readonly RevisionToken[]; readonly rawDiff: JsonValue; readonly resultDiff: JsonValue; readonly affectedReports: JsonValue; readonly createdAt: string };
export type StoredCorrectionPreview = CorrectionPreviewWrite;
export type CorrectionStageWrite = { readonly scopeId: string; readonly expectedBase: RevisionToken; readonly dependencyHeads: readonly RevisionToken[]; readonly evidence: readonly StoredEvidence[]; readonly inputs: readonly StoredInputSnapshot[]; readonly calculations: readonly StoredCalculation[]; readonly candidate: CandidateWrite & { readonly candidateId: string }; readonly import: WorkbookImportWrite; readonly preview: CorrectionPreviewWrite };
export type ImportResult = { readonly kind: 'invalid'; readonly importId: string | null; readonly errors: readonly WorkbookCellError[] } | { readonly kind: 'no-change'; readonly importId: string; readonly baseConfirmationId: string } | { readonly kind: 'preview'; readonly previewId: string; readonly previewHash: string };
export interface HistoryRepository {
  defaultScopeId(): Promise<string>;
  currentHeads(scopeId: string, cycles: readonly YearMonth[]): Promise<readonly RevisionToken[]>;
  putWorkbookImport(input: WorkbookImportWrite): Promise<StoredWorkbookImport>;
  getWorkbookImport(scopeId: string, id: string): Promise<StoredWorkbookImport | null>;
  getCorrectionPreview(scopeId: string, id: string): Promise<StoredCorrectionPreview | null>;
  stageCorrection(input: CorrectionStageWrite): Promise<StoredCorrectionPreview>;
  putEvidence(input: EvidenceWrite): Promise<{
    captureId: string;
  }>;
  getEvidence(scopeId: string, id: string): Promise<StoredEvidence | null>;
  putCalculation(input: CalculationWrite): Promise<{
    calculationId: string;
  }>;
  getCalculation(scopeId: string, id: string): Promise<StoredCalculation | null>;
  putInputSnapshot(input: InputSnapshotWrite): Promise<{
    inputSnapshotId: string;
  }>;
  getInputSnapshot(scopeId: string, id: string): Promise<StoredInputSnapshot | null>;
  putCandidate(input: CandidateWrite): Promise<{
    candidateId: string;
    documentHash: string;
  }>;
  getCandidate(scopeId: string, id: string): Promise<StoredCandidate | null>;
  commitConfirmation(scopeId: string, cmd: ConfirmationCommand): Promise<ConfirmationResult>;
  listCalculations(query: HistoryQuery): Promise<readonly StoredCalculation[]>;
  createHistorySelection(query: HistorySelectionQuery): Promise<ExternalHistorySelection>;
  getHistorySelection(scopeId: string, id: string): Promise<ExternalHistorySelection | null>;
  getConfirmation(scopeId: string, id: string): Promise<StoredConfirmation | null>;
  listConfirmations(scopeId: string, cycle?: YearMonth): Promise<readonly ConfirmationSummary[]>;
  putBatch(input: BatchWrite): Promise<{
    batchId: string;
  }>;
  getBatch(scopeId: string, id: string): Promise<StoredBatch | null>;
  listBatches(scopeId: string, status: 'active' | 'all', limit: number): Promise<readonly StoredBatch[]>;
  commitBatchStep(input: BatchStepWrite): Promise<StoredBatch>;
  claimCaptureSlot(input: CaptureClaim): Promise<CaptureClaimResult>;
  completeCaptureSlot(input: CaptureCompletion): Promise<{
    kind: 'saved';
    captureId: string;
  } | {
    kind: 'stale';
  }>;
  putWorkbookExport(input: WorkbookExportWrite): Promise<StoredWorkbookExport>;
  getWorkbookExport(scopeId: string, id: string): Promise<StoredWorkbookExport | null>;
}

/** Per-request capture dependencies; hashing and codecs stay outside the application layer. */
export type HistoryDependencies = {
  readonly repository: HistoryRepository;
  readonly indicators: EconomicIndicatorSource;
  readonly yields: BondYieldSource;
  readonly clock: () => Date;
  readonly metadataClock: () => Date;
  readonly hash: (value: unknown) => string;
  readonly encode: (value: unknown) => JsonValue;
  readonly decode?: <T>(value: JsonValue) => T;
  readonly calculationVersion: string;
  readonly captureIndicators: (source: EconomicIndicatorSource) => CapturedSource<EconomicIndicatorSource, SourceResult>;
  readonly captureYields: (source: BondYieldSource) => CapturedSource<BondYieldSource, YieldFetch>;
  readonly replayIndicators?: (observed: SourceObservation<SourceResult>) => EconomicIndicatorSource;
  readonly replayYields?: (observed: SourceObservation<YieldFetch>) => BondYieldSource;
  readonly isUnsafe: (value: unknown) => boolean;
};
export type ReportCorrectionDependencies = HistoryDependencies & {
  readonly workbookCodec: HistoryWorkbookCodec;
  readonly documentFactory: import('./report-candidate').ReportDocumentFactory;
  readonly nextId: () => string;
  readonly ecosCatalog: readonly { readonly key: string; readonly stat: string; readonly items: readonly string[] }[];
};
export type SourceObservation<T> =
  | { readonly kind: 'not-requested' }
  | { readonly kind: 'returned'; readonly value: T }
  | { readonly kind: 'threw'; readonly errorKind: 'error'; readonly message: string }
  | { readonly kind: 'threw'; readonly errorKind: 'non-error' };
export type CapturedSource<S, T> = { readonly source: S; readonly observation: () => SourceObservation<T> };
