import { SCORING_RULES } from '../../domain/risk/construction-perception/policy';
import { addMonths } from '../../domain/shared/year-month';
import { parseCalendarDate } from '../../domain/shared/calendar-date';
import { calendarOf } from '../../domain/cashflow/statement';
import type { SourceResult, YieldFetch } from '../ports';
import { restoreStatement } from './report-candidate';
import type { ExportRow, ReportCorrectionDependencies, SourceObservation, StoredCalculation, StoredWorkbookExport, WorkbookExportWrite } from './ports';
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
      rows.push({ rowId: `ecos:${key}:${month}`, sheet: '경제지표_정정', sourceRecordId: ecos?.captureId ?? '', sourceKind: 'ecos',
        fieldPath: `series.${key}.${month}`, identityJson: { indicator: key, month, statistic: catalog?.stat ?? '', items: catalog?.items ?? [], catalogOrigin: 'server-adapter-version' },
        unit, originalValue: value, allowedActions: editable ? ['keep', 'set', 'set-missing'] : ['keep'],
        protectedCells: { indicator: key, month, statistic: catalog?.stat ?? '', items: catalog?.items ?? [], reason: fetched && 'error' in fetched ? fetched.error : null } });
    }
  }
  snapshot.statements.forEach((dto, statementIndex) => {
    const statement = restoreStatement(dto);
    for (const item of ITEMS) {
      const values = dto.amounts[item];
      statement.months.forEach((m, monthIndex) => {
        const month = calendarOf(statement, m);
        const readable = Array.isArray(values);
        rows.push({ rowId: `statement:${statementIndex}:${item}:${monthIndex}`, sheet: '자금자료_정정', sourceRecordId: snapshot.inputSnapshotId,
          sourceKind: 'statement', fieldPath: `statements[${statementIndex}].amounts.${item}[${monthIndex}]`,
          identityJson: { statementIndex, asOf: dto.asOf, month, monthIndex, label: dto.monthLabels[monthIndex], item, baseMonthIndex: dto.baseMonthIndex, planYearEndIndex: dto.planYearEndIndex },
          unit: '억원', originalValue: readable ? values[monthIndex] : null, allowedActions: ['keep', 'set'],
          protectedCells: { unreadable: readable ? null : values,
            sourceFile: Array.isArray((snapshot.sourceMetadata as Record<string, unknown>)?.files) ? (snapshot.sourceMetadata as { files: unknown[] }).files[statementIndex] as string : '' } });
      });
    }
  });
  const kofia = await capture<YieldFetch>(deps, scopeId, funding, 'kofia');
  if (kofia?.observation.kind === 'returned' && 'days' in kofia.observation.value) {
    kofia.observation.value.days.forEach((day, dayIndex) => {
      parseCalendarDate(day.date);
      if (!day.date.startsWith(`${confirmation.basis.fundingObservedMonth}/`)) return;
      for (const [bond, quoted] of [['publicAaa', day.publicAaa], ['treasury', day.treasury]] as const) {
        rows.push({ rowId: `kofia:${day.date}:${bond}`, sheet: '조달금리_정정', sourceRecordId: kofia.captureId, sourceKind: 'kofia',
          fieldPath: `days[${dayIndex}].${bond}.average`, identityJson: { observedMonth: confirmation.basis.fundingObservedMonth, date: day.date, bond, maturity: '1년', dayIndex },
          unit: '%', originalValue: quoted.average, allowedActions: ['keep', 'set', 'set-missing'], protectedCells: { byAgency: quoted.byAgency } });
      }
    });
  }
  if (rows.length > 10_000 || rows.some(row => row.rowId.length > 2000)) return fail('LIMIT_EXCEEDED');
  const exportId = deps.nextId();
  const documentJson = confirmation.document.json as Record<string, unknown>;
  const metrics = Array.isArray(documentJson.metrics) ? documentJson.metrics : [];
  const result = metrics.map(metric => {
    const m = metric as Record<string, unknown>;
    return { title: typeof m.title === 'string' ? m.title : '', value: typeof m.value === 'string' ? m.value : '',
      status: typeof m.status === 'string' ? m.status : '', grade: typeof m.grade === 'string' ? m.grade : '', formula: typeof m.formula === 'string' ? m.formula : '' };
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
      return { kind: 'report-point', indicator, month, status,
        value: typeof point.value === 'number' ? point.value.toString() : '', secondary: typeof point.secondary === 'number' ? point.secondary.toString() : '',
        unit: pointUnits[indicator], planned: point.planned === true, reason: typeof point.reason === 'string' ? point.reason : '',
        lineage: calculation ? calculation.origin : 'stored-document', calculationId: calculation?.calculationId ?? '' };
    });
  });
  const history = [
    ...reportPoints,
    ...selection.headRevisions.slice(-18).map(head => ({ kind: 'confirmation-head', reportCycle: head.reportCycle, revision: head.revision, confirmationId: head.confirmationId })),
    ...selection.calculations.map(calculation => {
      const outcome = deps.decode?.<unknown>(calculation.resultJson) as { ok?: boolean; reason?: string; value?: { result?: Record<string, unknown> } } | undefined;
      const result = outcome?.value?.result;
      return { kind: 'calculation', indicator: calculation.indicator, month: calculation.effectiveMonth, calculationId: calculation.calculationId,
        origin: calculation.origin, status: outcome?.ok === false ? 'failed' : typeof result?.kind === 'string' ? result.kind : 'unknown',
        value: typeof result?.index === 'number' ? result.index.toString() : typeof result?.spread === 'number' ? result.spread.toString() : '',
        grade: typeof result?.grade === 'string' ? result.grade : '', reason: typeof outcome?.reason === 'string' ? outcome.reason : typeof result?.reason === 'string' ? result.reason : '' };
    }),
  ];
  const draft: Omit<WorkbookExportWrite, 'structure'> = { scopeId, exportId, workbookFormatVersion: 1, baseConfirmationId: confirmationId, baseRevision: confirmation.revision,
    baseDocumentHash: confirmation.document.contentHash, basis: confirmation.basis, inputSnapshotId: snapshot.inputSnapshotId, inputHash: snapshot.inputHash,
    calculationIds: confirmation.canonicalCurrentCalculationIds, historySelectionId: confirmation.historySelectionId,
    calculationVersion: candidate.calculationVersion, templateVersion: confirmation.document.templateVersion,
    createdAt: deps.metadataClock().toISOString(), rows, history, result };
  const manifest: StoredWorkbookExport = { ...draft, structure: deps.workbookCodec.structure(draft) };
  return deps.repository.putWorkbookExport(manifest);
}

export async function downloadCorrectionWorkbook(deps: ReportCorrectionDependencies, scopeId: string, exportId: string): Promise<Uint8Array> {
  const manifest = await deps.repository.getWorkbookExport(scopeId, exportId);
  if (!manifest) return fail('NOT_FOUND');
  if (manifest.workbookFormatVersion !== 1 || manifest.calculationVersion !== deps.calculationVersion || manifest.templateVersion !== HISTORY_TEMPLATE_VERSION) return fail('UNSUPPORTED_VERSION');
  return deps.workbookCodec.encode(manifest);
}
