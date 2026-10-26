import { assessDashboard } from '../dashboard';
import { assessPerception, type PerceptionRequest } from '../construction-perception';
import { assessFundingRiskReport, type FundingRiskRequest } from '../funding-risk';
import { ledgerOf } from '../../domain/cashflow/forecast-ledger';
import { roundEntryOf } from '../../domain/cashflow/round-entry';
import { HistoryOperationError } from './ports';
import { SCORING_RULES } from '../../domain/risk/construction-perception/policy';
import { addMonths, type YearMonth } from '../../domain/shared/year-month';
import { parseCalendarDate } from '../../domain/shared/calendar-date';
import { calendarOf, type ItemName, type Unreadable } from '../../domain/cashflow/statement';
import type { SourceResult, YieldFetch } from '../ports';
import { restoreStatement } from './report-candidate';
import type {
  CandidateWrite, CorrectionConfirmCommand, CorrectionPatch, DecodedCorrection, Derivation, HistoryOperationErrorCode, HistoryRepository, ImportResult, JsonValue, ReportBasis, StatementSnapshotDto, StoredCalculation, StoredCorrectionPreview, StoredEvidence, StoredInputSnapshot, WorkbookCellError, WorkbookImportWrite, ExportRow, ReportCorrectionDependencies, SourceObservation, StoredWorkbookExport, WorkbookExportWrite
} from './ports';
import { HISTORY_TEMPLATE_VERSION } from '../../domain/report-history/report-history';

const fail = (code: string): never => { throw Error(code); };
const ITEMS = ['기초시재', '수입계', '수입', '분양회수', '기타수입', '지출'] as const;

async function capture<T>(deps: ReportCorrectionDependencies, scopeId: string, calculation: StoredCalculation, kind: 'ecos' | 'kofia'): Promise<{ captureId: string; observation: SourceObservation<T> } | null> {
  for (const captureId of calculation.captureIds) {
    const evidence = await deps.repository.getEvidence(scopeId, captureId);
    if (!evidence) throw Error('NOT_FOUND');
    if (evidence.sourceKind === kind) {
      if (evidence.schemaVersion !== 1 || !deps.decode) throw Error('UNSUPPORTED_VERSION');
      return { captureId, observation: deps.decode<SourceObservation<T>>(evidence.payloadJson) };
    }
  }
  return null;
}

/** Export exactly the stored revision. No live source is touched. */
export async function exportCorrectionWorkbook(deps: ReportCorrectionDependencies, scopeId: string, confirmationId: string): Promise<StoredWorkbookExport> {
  const confirmation = await deps.repository.getConfirmation(scopeId, confirmationId);
  if (!confirmation) return fail('NOT_FOUND');
  const candidate = await deps.repository.getCandidate(scopeId, confirmation.candidateId);
  if (!candidate) return fail('NOT_FOUND');
  const snapshot = await deps.repository.getInputSnapshot(scopeId, candidate.inputSnapshotId);
  if (!snapshot) return fail('NOT_FOUND');
  const selection = await deps.repository.getHistorySelection(scopeId, confirmation.historySelectionId);
  const [construction, funding] = await Promise.all([
    deps.repository.getCalculation(scopeId, confirmation.canonicalCurrentCalculationIds.construction),
    deps.repository.getCalculation(scopeId, confirmation.canonicalCurrentCalculationIds.funding),
  ]);
  if (!selection || !construction || !funding) return fail('NOT_FOUND');
  if (confirmation.document.schemaVersion !== 1 || confirmation.document.templateVersion !== HISTORY_TEMPLATE_VERSION ||
    candidate.document.contentHash !== confirmation.document.contentHash || candidate.inputHash !== snapshot.inputHash ||
    candidate.calculationVersion !== deps.calculationVersion || construction.calculationVersion !== deps.calculationVersion || funding.calculationVersion !== deps.calculationVersion ||
    construction.indicator !== 'construction' || funding.indicator !== 'funding' || construction.scopeId !== scopeId || funding.scopeId !== scopeId ||
    selection.scopeId !== scopeId || selection.historySelectionId !== confirmation.historySelectionId ||
    candidate.calculationIds.construction !== construction.calculationId || candidate.calculationIds.funding !== funding.calculationId) return fail('UNSUPPORTED_VERSION');
  const rows: ExportRow[] = [];
  const ecos = await capture<SourceResult>(deps, scopeId, construction, 'ecos');
  for (const rule of SCORING_RULES) {
    if (rule.key === '분양회수예측오차') continue;
    const key = rule.key;
    const months = [confirmation.basis.constructionBaseMonth, addMonths(confirmation.basis.constructionBaseMonth, rule.transform === '전년동월비' ? -12 : -1)];
    const fetched = ecos?.observation.kind === 'returned' ? ecos.observation.value[key] : null;
    const unit = fetched && 'unit' in fetched ? fetched.unit : '';
    const series = fetched && 'values' in fetched ? fetched.values : null;
    const catalog = deps.ecosCatalog.find(item => item.key === key);
    for (const month of months) {
      const value = series?.get(month) ?? null;
      const editable = Boolean(series && unit.trim());
      rows.push({
        rowId: `ecos:${key}:${month}`, sheet: '경제지표_정정', sourceRecordId: ecos?.captureId ?? '', sourceKind: 'ecos',
        fieldPath: `series.${key}.${month}`, identityJson: { indicator: key, month, statistic: catalog?.stat ?? '', items: catalog?.items ?? [], catalogOrigin: 'server-adapter-version' },
        unit, originalValue: value, allowedActions: editable ? ['keep', 'set', 'set-missing'] : ['keep'],
        protectedCells: { indicator: key, month, statistic: catalog?.stat ?? '', items: catalog?.items ?? [], reason: fetched && 'error' in fetched ? fetched.error : null }
      });
    }
  }
  snapshot.statements.forEach((dto, statementIndex) => {
    const statement = restoreStatement(dto);
    for (const item of ITEMS) {
      const values = dto.amounts[item];
      statement.months.forEach((m, monthIndex) => {
        const month = calendarOf(statement, m);
        const readable = Array.isArray(values);
        rows.push({
          rowId: `statement:${statementIndex}:${item}:${monthIndex}`, sheet: '자금자료_정정', sourceRecordId: snapshot.inputSnapshotId,
          sourceKind: 'statement', fieldPath: `statements[${statementIndex}].amounts.${item}[${monthIndex}]`,
          identityJson: { statementIndex, asOf: dto.asOf, month, monthIndex, label: dto.monthLabels[monthIndex], item, baseMonthIndex: dto.baseMonthIndex, planYearEndIndex: dto.planYearEndIndex },
          unit: '억원', originalValue: readable ? values[monthIndex] : null, allowedActions: ['keep', 'set'],
          protectedCells: {
            unreadable: readable ? null : values,
            sourceFile: Array.isArray((snapshot.sourceMetadata as Record<string, unknown>)?.files) ? (snapshot.sourceMetadata as { files: unknown[] }).files[statementIndex] as string : ''
          }
        });
      });
    }
  });
  const kofia = await capture<YieldFetch>(deps, scopeId, funding, 'kofia');
  if (kofia?.observation.kind === 'returned' && 'days' in kofia.observation.value) {
    kofia.observation.value.days.forEach((day, dayIndex) => {
      parseCalendarDate(day.date);
      if (!day.date.startsWith(`${confirmation.basis.fundingObservedMonth}/`)) return;
      for (const [bond, quoted] of [['publicAaa', day.publicAaa], ['treasury', day.treasury]] as const) {
        rows.push({
          rowId: `kofia:${day.date}:${bond}`, sheet: '조달금리_정정', sourceRecordId: kofia.captureId, sourceKind: 'kofia',
          fieldPath: `days[${dayIndex}].${bond}.average`, identityJson: { observedMonth: confirmation.basis.fundingObservedMonth, date: day.date, bond, maturity: '1년', dayIndex },
          unit: '%', originalValue: quoted.average, allowedActions: ['keep', 'set', 'set-missing'], protectedCells: { byAgency: quoted.byAgency }
        });
      }
    });
  }
  if (rows.length > 10_000 || rows.some(row => row.rowId.length > 2000)) return fail('LIMIT_EXCEEDED');
  const exportId = deps.nextId();
  const documentJson = confirmation.document.json as Record<string, unknown>;
  const metrics = Array.isArray(documentJson.metrics) ? documentJson.metrics : [];
  const result = metrics.map(metric => {
    const m = metric as Record<string, unknown>;
    return {
      title: typeof m.title === 'string' ? m.title : '', value: typeof m.value === 'string' ? m.value : '',
      status: typeof m.status === 'string' ? m.status : '', grade: typeof m.grade === 'string' ? m.grade : '', formula: typeof m.formula === 'string' ? m.formula : ''
    };
  });
  const pointUnits: Record<string, string> = { recovery: '배', liquidity: '배', construction: '지수', funding: '%p', cash: '억원' };
  const reportPoints = metrics.flatMap(metric => {
    const m = metric as Record<string, unknown>;
    const indicator = typeof m.id === 'string' ? m.id : '';
    if (!(indicator in pointUnits) || !Array.isArray(m.points)) return [];
    return m.points.slice(-18).map(rawPoint => {
      const point = rawPoint as Record<string, unknown>;
      const month = typeof point.month === 'string' ? point.month : '';
      const status = typeof point.kind === 'string' ? point.kind : 'missing';
      const canonical = indicator === 'construction' && month === confirmation.basis.constructionBaseMonth ? construction
        : indicator === 'funding' && month === confirmation.basis.fundingObservedMonth ? funding : null;
      const calculation = canonical ?? selection.calculations.find(item => {
        if (item.indicator !== indicator || item.effectiveMonth !== month) return false;
        const outcome = deps.decode?.<unknown>(item.resultJson) as { value?: { result?: Record<string, unknown> } } | undefined;
        const measured = indicator === 'construction' ? outcome?.value?.result?.index : outcome?.value?.result?.spread;
        return status === 'available' ? typeof measured === 'number' && measured === point.value : measured === undefined;
      });
      return {
        kind: 'report-point', indicator, month, status,
        value: typeof point.value === 'number' ? point.value.toString() : '', secondary: typeof point.secondary === 'number' ? point.secondary.toString() : '',
        unit: pointUnits[indicator], planned: point.planned === true, reason: typeof point.reason === 'string' ? point.reason : '',
        lineage: calculation ? calculation.origin : 'stored-document', calculationId: calculation?.calculationId ?? ''
      };
    });
  });
  const history = [
    ...reportPoints,
    ...selection.headRevisions.slice(-18).map(head => ({ kind: 'confirmation-head', reportCycle: head.reportCycle, revision: head.revision, confirmationId: head.confirmationId })),
    ...selection.calculations.map(calculation => {
      const outcome = deps.decode?.<unknown>(calculation.resultJson) as { ok?: boolean; reason?: string; value?: { result?: Record<string, unknown> } } | undefined;
      const result = outcome?.value?.result;
      return {
        kind: 'calculation', indicator: calculation.indicator, month: calculation.effectiveMonth, calculationId: calculation.calculationId,
        origin: calculation.origin, status: outcome?.ok === false ? 'failed' : typeof result?.kind === 'string' ? result.kind : 'unknown',
        value: typeof result?.index === 'number' ? result.index.toString() : typeof result?.spread === 'number' ? result.spread.toString() : '',
        grade: typeof result?.grade === 'string' ? result.grade : '', reason: typeof outcome?.reason === 'string' ? outcome.reason : typeof result?.reason === 'string' ? result.reason : ''
      };
    }),
  ];
  const draft: Omit<WorkbookExportWrite, 'structure'> = {
    scopeId, exportId, workbookFormatVersion: 1, baseConfirmationId: confirmationId, baseRevision: confirmation.revision,
    baseDocumentHash: confirmation.document.contentHash, basis: confirmation.basis, inputSnapshotId: snapshot.inputSnapshotId, inputHash: snapshot.inputHash,
    calculationIds: confirmation.canonicalCurrentCalculationIds, historySelectionId: confirmation.historySelectionId,
    calculationVersion: candidate.calculationVersion, templateVersion: confirmation.document.templateVersion,
    createdAt: deps.metadataClock().toISOString(), rows, history, result
  };
  const manifest: StoredWorkbookExport = { ...draft, structure: deps.workbookCodec.structure(draft) };
  return deps.repository.putWorkbookExport(manifest);
}

export async function downloadCorrectionWorkbook(deps: ReportCorrectionDependencies, scopeId: string, exportId: string): Promise<Uint8Array> {
  const manifest = await deps.repository.getWorkbookExport(scopeId, exportId);
  if (!manifest) return fail('NOT_FOUND');
  if (manifest.workbookFormatVersion !== 1 || manifest.calculationVersion !== deps.calculationVersion || manifest.templateVersion !== HISTORY_TEMPLATE_VERSION) return fail('UNSUPPORTED_VERSION');
  return deps.workbookCodec.encode(manifest);
}

function fileError(code = 'INVALID_WORKBOOK'): WorkbookCellError {
  return { sheet: null, row: null, column: null, code, message: '앱에서 내보낸 정정용 파일과 입력 칸을 확인하세요.' };
}
function operation(code: HistoryOperationErrorCode): never { throw new HistoryOperationError(code); }
function checkedVersion(deps: ReportCorrectionDependencies, manifest: StoredWorkbookExport): void {
  if (manifest.workbookFormatVersion !== 1 || manifest.calculationVersion !== deps.calculationVersion || manifest.templateVersion !== HISTORY_TEMPLATE_VERSION) operation('UNSUPPORTED_VERSION');
}
function reportInput(statements: readonly StatementSnapshotDto[], basis: ReportBasis) {
  const restored = statements.map(restoreStatement), latest = restored.at(-1);
  if (!latest || calendarOf(latest, latest.defaultBaseMonth) !== basis.reportCycle) throw Error('INVALID_STATEMENT');
  const previous = restored.find(item => calendarOf(item, item.defaultBaseMonth) === addMonths(basis.reportCycle, -1)) ?? null;
  const month = latest.months.find(month => calendarOf(latest, month) === basis.gapMonth);
  if (!month) throw Error('INVALID_STATEMENT');
  const ledger = ledgerOf(restored.flatMap(statement => { try { return [roundEntryOf(statement)]; } catch { return []; } }));
  return { statements: restored, ledger, ledgerInput: ledger.rounds().map(round => ledger.entryOf(round)), dashboard: assessDashboard(previous, latest, month) };
}
function checkEvaluation(parent: StoredCalculation): void {
  const first = new Date(parent.evaluatedAt);
  if (Intl.DateTimeFormat().resolvedOptions().timeZone !== parent.evaluationTimeZone || first.getFullYear() !== parent.evaluatedCalendar.year || first.getMonth() + 1 !== parent.evaluatedCalendar.month || first.getDate() !== parent.evaluatedCalendar.day) operation('EVALUATION_ZONE_MISMATCH');
  if (!parent.evaluationClockTrace.length || parent.evaluationClockTrace[0] !== parent.evaluatedAt) operation('UNSUPPORTED_VERSION');
}
async function replayCalculation(deps: ReportCorrectionDependencies, parent: StoredCalculation, restored: ReturnType<typeof reportInput>, evidence: readonly StoredEvidence[]) {
  checkEvaluation(parent);
  if (!deps.decode || !deps.replayIndicators || !deps.replayYields) return operation('UNSUPPORTED_VERSION');
  const context = deps.decode<{ request: PerceptionRequest & FundingRiskRequest; input: unknown; sourceState: string }>(parent.requestContext);
  const capture = evidence.find(item => item.sourceKind === (parent.indicator === 'construction' ? 'ecos' : 'kofia'));
  const observation = capture ? deps.decode<SourceObservation<SourceResult & YieldFetch>>(capture.payloadJson) : { kind: 'not-requested' } as const;
  let clockCalls = 0, sourceCalls = 0, traceMismatch = false;
  const clock = () => {
    const instant = parent.evaluationClockTrace[clockCalls++];
    if (!instant) {
      traceMismatch = true;
      throw Error('CLOCK_TRACE_MISMATCH');
    }
    return new Date(instant);
  };
  const economic = deps.replayIndicators(observation), bond = deps.replayYields(observation);
  const outcome = parent.indicator === 'construction'
    ? await assessPerception({
      fetchAll: () => {
        sourceCalls++;
        return economic.fetchAll();
      }
    }, restored.ledger, context.request, clock)
    : await assessFundingRiskReport({
      dailyYields: month => {
        sourceCalls++;
        return bond.dailyYields(month);
      }
    }, context.request, clock);
  if (traceMismatch || clockCalls !== parent.evaluationClockTrace.length || (observation.kind === 'not-requested' && sourceCalls !== 0)) operation('UNSUPPORTED_VERSION');
  const input = parent.indicator === 'construction' ? restored.ledgerInput : context.input;
  return { outcome, inputHash: deps.hash(input), requestContext: deps.encode({ ...context, input }) };
}

/** Validate and replay against immutable local records. Only stageCorrection publishes derived records. */
export async function validateCorrectionWorkbook(deps: ReportCorrectionDependencies, scopeId: string, bytes: Uint8Array): Promise<ImportResult> {
  let exportId: string;
  try { exportId = deps.workbookCodec.readExportId(bytes); }
  catch (error) {
    if (error instanceof Error && error.message === 'LIMIT_EXCEEDED') operation('LIMIT_EXCEEDED');
    return { kind: 'invalid', importId: null, errors: [fileError()] };
  }
  const manifest = await deps.repository.getWorkbookExport(scopeId, exportId);
  if (!manifest) return { kind: 'invalid', importId: null, errors: [fileError('UNKNOWN_EXPORT')] };
  checkedVersion(deps, manifest);
  let decoded: DecodedCorrection;
  try { decoded = deps.workbookCodec.decode(bytes, manifest); }
  catch (error) {
    if (error instanceof Error && error.message === 'LIMIT_EXCEEDED') operation('LIMIT_EXCEEDED');
    decoded = { patch: [], errors: [fileError()] };
  }
  const receivedAt = deps.metadataClock().toISOString(), importId = deps.nextId();
  const imported: WorkbookImportWrite = { scopeId, importId, exportId, fileHash: deps.hash(Array.from(bytes)), patchHash: null, patch: [], status: 'invalid', errors: decoded.errors, receivedAt };
  if (decoded.errors.length) {
    await deps.repository.putWorkbookImport(imported);
    return { kind: 'invalid', importId, errors: decoded.errors };
  }
  if (!decoded.patch.length) {
    await deps.repository.putWorkbookImport({ ...imported, status: 'no-change' });
    return { kind: 'no-change', importId, baseConfirmationId: manifest.baseConfirmationId };
  }
  const snapshot = await deps.repository.getInputSnapshot(scopeId, manifest.inputSnapshotId), selection = await deps.repository.getHistorySelection(scopeId, manifest.historySelectionId);
  const base = await deps.repository.getConfirmation(scopeId, manifest.baseConfirmationId);
  const parents = await Promise.all(Object.values(manifest.calculationIds).map(id => deps.repository.getCalculation(scopeId, id)));
  if (!snapshot || !selection || !base || parents.some(p => !p)) return operation('NOT_FOUND');
  const calculations = parents as StoredCalculation[];
  calculations.forEach(checkEvaluation);
  const cycles = [...new Set([manifest.basis.reportCycle, ...selection.headRevisions.map(head => head.reportCycle)])];
  const dependencyHeads = await deps.repository.currentHeads(scopeId, cycles);
  const expectedBase = { reportCycle: manifest.basis.reportCycle, confirmationId: manifest.baseConfirmationId, revision: manifest.baseRevision };
  if (!dependencyHeads.some(token => token.reportCycle === expectedBase.reportCycle && token.confirmationId === expectedBase.confirmationId && token.revision === expectedBase.revision)) operation('STALE_BASE');
  const clone = <T,>(value: T): T => deps.decode!<T>(deps.encode(value));
  const statements = clone(snapshot.statements) as { amounts: Record<ItemName, number[] | Unreadable>; monthLabels: readonly string[] }[] & StatementSnapshotDto[];
  const patchHash = deps.hash(decoded.patch), derivation = (parentId: string): Derivation => ({ kind: 'manual-correction', parentId, importId, patchHash, correctedAt: receivedAt });
  const originals = await Promise.all([...new Set(calculations.flatMap(c => c.captureIds))].map(id => deps.repository.getEvidence(scopeId, id)));
  if (originals.some(item => !item)) return operation('NOT_FOUND');
  const evidence = originals as StoredEvidence[];
  const changedEvidence = new Map<string, StoredEvidence>();
  const pendingUnreadable = new Map<string, Map<number, number>>();
  for (const patch of decoded.patch) {
    const row = manifest.rows.find(row => row.rowId === patch.rowId)!;
    if (!row || !row.allowedActions.includes(patch.action)) return { kind: 'invalid', importId: null, errors: [fileError()] };
    const identity = row.identityJson as Record<string, string | number>;
    if (row.sourceKind === 'statement') {
      const index = Number(identity.statementIndex), monthIndex = Number(identity.monthIndex), item = identity.item as typeof ITEMS[number];
      const statement = statements[index];
      if (!statement || !ITEMS.includes(item) || monthIndex < 0 || monthIndex >= statement.monthLabels.length || patch.value === null) return { kind: 'invalid', importId: null, errors: [fileError()] };
      const amount = statement.amounts[item];
      if (Array.isArray(amount)) amount[monthIndex] = patch.value;
      else {
        const key = `${index}:${item}`, pending = pendingUnreadable.get(key) ?? new Map<number, number>();
        pending.set(monthIndex, patch.value);
        pendingUnreadable.set(key, pending);
      }
    } else {
      const original = evidence.find(item => item.captureId === row.sourceRecordId);
      if (!original) return operation('NOT_FOUND');
      const changed = changedEvidence.get(original.captureId) ?? { ...original, captureId: deps.nextId(), derivation: derivation(original.captureId) };
      const observation = clone(deps.decode!<SourceObservation<SourceResult & YieldFetch>>(changed.payloadJson));
      if (observation.kind !== 'returned') return { kind: 'invalid', importId: null, errors: [fileError()] };
      if (row.sourceKind === 'ecos') {
        const series = observation.value[identity.indicator as keyof SourceResult];
        if (!series || !('values' in series) || !series.unit.trim()) return { kind: 'invalid', importId: null, errors: [fileError()] };
        const values = series.values as Map<YearMonth, number>;
        if (patch.value === null) values.delete(identity.month as YearMonth); else values.set(identity.month as YearMonth, patch.value);
      } else {
        if (!('days' in observation.value)) return { kind: 'invalid', importId: null, errors: [fileError()] };
        const day = observation.value.days[Number(identity.dayIndex)];
        if (!day || !['publicAaa', 'treasury'].includes(String(identity.bond))) return { kind: 'invalid', importId: null, errors: [fileError()] };
        (day[identity.bond as 'publicAaa' | 'treasury'] as { average: number | null }).average = patch.value;
      }
      changedEvidence.set(original.captureId, { ...changed, payloadJson: deps.encode(observation), contentHash: deps.hash(observation) });
    }
  }
  const repairErrors: WorkbookCellError[] = [];
  for (const [key, values] of pendingUnreadable) {
    const [rawIndex, item] = key.split(':');
    const index = Number(rawIndex), statement = statements[index];
    if (values.size !== statement.monthLabels.length) repairErrors.push({ sheet: '자금자료_정정', row: null, column: 'H', code: 'INCOMPLETE_SERIES', message: '읽을 수 없던 항목의 모든 기존 월 값을 입력하세요.' });
    else statement.amounts[item as typeof ITEMS[number]] = statement.monthLabels.map((_, i) => values.get(i)!);
  }
  if (repairErrors.length) {
    await deps.repository.putWorkbookImport({ ...imported, errors: repairErrors });
    return { kind: 'invalid', importId, errors: repairErrors };
  }
  const restored = reportInput(statements, manifest.basis), originalInput = reportInput(snapshot.statements, manifest.basis);
  const currentEvidence = evidence.map(item => changedEvidence.get(item.captureId) ?? item);
  const derived: StoredCalculation[] = [];
  const outcomes: unknown[] = [];
  for (const parent of calculations) {
    const selected = parent.captureIds.map(id => currentEvidence.find(e => e.captureId === (changedEvidence.get(id)?.captureId ?? id))!);
    const replay = await replayCalculation(deps, parent, restored, selected);
    outcomes.push(replay.outcome);
    derived.push({ ...parent, calculationId: deps.nextId(), derivation: derivation(parent.calculationId), captureIds: selected.map(item => item.captureId), resultJson: deps.encode(replay.outcome), requestContext: replay.requestContext, inputHash: replay.inputHash, createdAt: receivedAt });
  }
  const changedInput = deps.hash(statements) !== snapshot.inputHash;
  const input = changedInput ? { ...snapshot, inputSnapshotId: deps.nextId(), statements, inputHash: deps.hash(statements), derivation: derivation(snapshot.inputSnapshotId), createdAt: receivedAt } : snapshot;
  const document = deps.documentFactory({ ...restored, sourceMetadata: snapshot.sourceMetadata, constructionOutcome: outcomes[0], fundingOutcome: outcomes[1], basis: manifest.basis, authoredAt: new Date(receivedAt) }, selection);
  if (document.templateVersion !== manifest.templateVersion || deps.hash(document.json) !== document.contentHash || deps.hash(document.historyCalculationIds) !== deps.hash(selection.historyCalculationIds)) operation('UNSUPPORTED_VERSION');
  const previewId = deps.nextId(), candidateId = deps.nextId();
  const candidate: CandidateWrite & { candidateId: string } = {
    scopeId, candidateId, basis: manifest.basis, inputSnapshotId: input.inputSnapshotId, inputHash: input.inputHash, calculationVersion: deps.calculationVersion,
    calculationInputHashes: { construction: derived[0].inputHash, funding: derived[1].inputHash }, calculationIds: { construction: derived[0].calculationId, funding: derived[1].calculationId }, historySelectionId: selection.historySelectionId, authoredAt: receivedAt, preparedAt: receivedAt, document, correctionPreviewId: previewId
  };
  const rawDiff = decoded.patch.map(patch => {
    const row = manifest.rows.find(row => row.rowId === patch.rowId)!;
    return { rowId: row.rowId, sheet: row.sheet, identity: row.identityJson, unit: row.unit, before: row.originalValue, after: patch.value, action: patch.action, reason: patch.reason, evidenceNote: patch.evidenceNote, sourceRecordId: row.sourceRecordId };
  });
  const beforeResults = [originalInput.dashboard.paymentRecovery, originalInput.dashboard.liquidityGap, originalInput.dashboard.adequateCash, ...calculations.map(c => deps.decode!(c.resultJson))];
  const afterResults = [restored.dashboard.paymentRecovery, restored.dashboard.liquidityGap, restored.dashboard.adequateCash, ...outcomes];
  const resultDiff = ['recovery', 'liquidity', 'cash', 'construction', 'funding'].map((indicator, index) => ({ indicator, ...correctionResultDifference(beforeResults[index], afterResults[index]), before: deps.encode(beforeResults[index]), after: deps.encode(afterResults[index]) }));
  const affectedReports = await affected(deps, scopeId, manifest, decoded.patch, statements, changedEvidence);
  const previewBody = { scopeId, previewId, importId, exportId, baseConfirmationId: manifest.baseConfirmationId, baseRevision: manifest.baseRevision, inputSnapshotId: input.inputSnapshotId, candidateId, dependencyHeads, rawDiff, resultDiff, affectedReports, createdAt: receivedAt };
  const previewHash = deps.hash({ patch: decoded.patch, inputHash: input.inputHash, calculations: derived.map(c => ({ inputHash: c.inputHash, result: c.resultJson, captureIds: c.captureIds })), documentHash: document.contentHash, baseRevision: manifest.baseRevision, dependencyHeads });
  const preview = await deps.repository.stageCorrection({ scopeId, expectedBase, dependencyHeads, evidence: [...changedEvidence.values()], inputs: changedInput ? [input] : [], calculations: derived, candidate, import: { ...imported, status: 'validated', patch: decoded.patch, patchHash }, preview: { ...previewBody, previewHash } });
  return { kind: 'preview', previewId: preview.previewId, previewHash: preview.previewHash };
}

export function correctionResultDifference(before: unknown, after: unknown): { changed: boolean; beforeDisplay: string; afterDisplay: string } {
  const beforeDisplay = resultDisplay(before), afterDisplay = resultDisplay(after);
  return { changed: resultComparisonKey(before, beforeDisplay) !== resultComparisonKey(after, afterDisplay), beforeDisplay, afterDisplay };
}

function resultComparisonKey(value: unknown, display: string): string {
  const outcome = value as { value?: { result?: { kind?: string; missing?: { key: string; reason: string }[] } } } | null;
  const result = outcome?.value?.result;
  if (result?.kind !== 'unavailable' || !Array.isArray(result.missing)) return display;
  const pairs = result.missing.map(item => [item.key, item.reason]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({ display, pairs });
}

function resultDisplay(value: unknown): string {
  if (value === null) return '산출 대상 아님';
  const outcome = value as { ok?: boolean; reason?: string; value?: Record<string, unknown> };
  if (outcome.ok === false) return `산출불가 · ${outcome.reason ?? ''}`;
  const result = (outcome.value?.result ?? outcome.value) as Record<string, unknown> | undefined;
  if (!result) return '산출불가';
  if (result.kind === 'unavailable') {
    const missing = Array.isArray(result.missing) ? result.missing.filter((item): item is { key: string; reason: string } =>
      item !== null && typeof item === 'object' && typeof item.key === 'string' && typeof item.reason === 'string') : [];
    const details = missing.map(item => `${JSON.stringify(item.key)}: ${JSON.stringify(item.reason)}`).sort().join(' / ');
    return `산출불가 · ${details || (typeof result.reason === 'string' ? result.reason : '필요한 원천값이 없습니다.')}`;
  }
  if (result.kind === 'invalid') return `산출불가 · ${result.reason ?? ''}`;
  const measured = result.index ?? result.spread ?? result.rate ?? result.gapRatio ?? result.adequateCash;
  return [typeof measured === 'number' ? measured.toString() : result.kind === 'net-inflow' ? '비적용 · 순유입' : '산출', typeof result.grade === 'string' ? result.grade : typeof result.isAdequate === 'boolean' ? (result.isAdequate ? '충족' : '부족') : ''].filter(Boolean).join(' · ');
}

async function affected(deps: ReportCorrectionDependencies, scopeId: string, manifest: StoredWorkbookExport, patch: CorrectionPatch, statements: readonly StatementSnapshotDto[], changedEvidence: ReadonlyMap<string, StoredEvidence>): Promise<JsonValue[]> {
  const reports = await deps.repository.listConfirmations(scopeId), latest = new Map<string, typeof reports[number]>();
  for (const report of reports) if ((latest.get(report.reportCycle)?.revision ?? 0) < report.revision) latest.set(report.reportCycle, report);
  const lineage = async (kind: 'input' | 'evidence', id: string): Promise<Set<string>> => {
    const seen = new Set<string>();
    let next: string | null = id;
    while (next) {
      if (seen.has(next)) throw Error('INVALID_LINEAGE');
      seen.add(next);
      const record: StoredInputSnapshot | StoredEvidence | null = kind === 'input' ? await deps.repository.getInputSnapshot(scopeId, next) : await deps.repository.getEvidence(scopeId, next);
      if (!record) throw Error('INVALID_LINEAGE');
      next = record.derivation.kind === 'manual-correction' ? record.derivation.parentId : null;
    }
    return seen;
  };
  const inputChanged = patch.some(p => manifest.rows.find(row => row.rowId === p.rowId)?.sourceKind === 'statement');
  const targetInputLineage = inputChanged ? await lineage('input', manifest.inputSnapshotId) : new Set<string>();
  const targetSourceLineage = new Set<string>();
  for (const id of changedEvidence.keys()) for (const parent of await lineage('evidence', id)) targetSourceLineage.add(parent);
  const result: JsonValue[] = [];
  for (const report of latest.values()) {
    if (report.reportCycle === manifest.basis.reportCycle) continue;
    const confirmation = await deps.repository.getConfirmation(scopeId, report.confirmationId);
    if (!confirmation) continue;
    const candidate = await deps.repository.getCandidate(scopeId, confirmation.candidateId);
    if (!candidate) continue;
    const input = await deps.repository.getInputSnapshot(scopeId, candidate.inputSnapshotId);
    if (!input) continue;
    const sharedInput = candidate.inputSnapshotId === manifest.inputSnapshotId && inputChanged;
    const sharedInputParent = inputChanged && [...await lineage('input', candidate.inputSnapshotId)].some(id => targetInputLineage.has(id));
    const calculations = await Promise.all(Object.values(candidate.calculationIds).map(id => deps.repository.getCalculation(scopeId, id)));
    for (const parent of calculations) {
      if (!parent) continue;
      const direct = sharedInput || parent.captureIds.some(id => changedEvidence.has(id));
      if (!direct) {
        let sharedParent = sharedInputParent;
        for (const id of parent.captureIds) if ([...await lineage('evidence', id)].some(ancestor => targetSourceLineage.has(ancestor))) sharedParent = true;
        if (sharedParent) result.push({ confirmationId: report.confirmationId, reportCycle: report.reportCycle, revision: report.revision, indicator: parent.indicator, status: 'possible', lineage: 'shared-parent', reason: '부모 출처를 공유하지만 현재 선택 자료가 달라 직접 재계산할 수 없습니다. 별도 정정이 필요합니다.' });
        continue;
      }
      try {
        const restored = reportInput(sharedInput ? statements : input.statements, candidate.basis);
        const evidence = await Promise.all(parent.captureIds.map(async id => changedEvidence.get(id) ?? await deps.repository.getEvidence(scopeId, id)));
        if (evidence.some(e => !e)) throw Error('MISSING_EVIDENCE');
        const replay = await replayCalculation(deps, parent, restored, evidence as StoredEvidence[]);
        result.push({ confirmationId: report.confirmationId, reportCycle: report.reportCycle, revision: report.revision, indicator: parent.indicator, status: 'recalculated', changed: deps.hash(replay.outcome) !== deps.hash(deps.decode!(parent.resultJson)), before: parent.resultJson, after: deps.encode(replay.outcome) });
      } catch { result.push({ confirmationId: report.confirmationId, reportCycle: report.reportCycle, revision: report.revision, indicator: parent.indicator, status: 'possible', reason: '저장된 평가 문맥에서 영향 재계산이 불가능합니다.' }); }
    }
  }
  return result;
}
export async function getCorrectionPreview(repository: HistoryRepository, scopeId: string, previewId: string): Promise<StoredCorrectionPreview | null> { return repository.getCorrectionPreview(scopeId, previewId); }
/** Explicit commit only; recalculation and source access occurred at validation time. */
export async function confirmWorkbookCorrection(deps: ReportCorrectionDependencies, scopeId: string, cmd: CorrectionConfirmCommand) {
  return deps.repository.commitCorrection(scopeId, cmd);
}
