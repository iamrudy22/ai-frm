import { unreadable, type ItemName, type Unreadable } from '../cashflow/statement';
import { SCORING_RULES, type IndicatorKey, type ScoringRule } from '../risk/construction-perception/policy';
import { AGENCIES, type Agency, type BondYield, type DailyYields } from '../risk/funding-risk/funding-risk';
import { calendarDate, monthOfDate, type CalendarDate } from '../shared/calendar-date';
import { addMonths, parseYearMonth, yearMonth, type YearMonth } from '../shared/year-month';
import { HISTORY_CALCULATION_VERSION, HISTORY_TEMPLATE_VERSION, type PreparedDocument, type ReportBasis } from './report-history';

export type EcosIndicatorKey = Exclude<IndicatorKey, '분양회수예측오차'>;
/** Neutral source identifiers are injected by the application; domain knows no ECOS adapter. */
export type ManualEconomicDefinition = { readonly key: EcosIndicatorKey; readonly name: string; readonly statistic: string; readonly items: readonly string[] };
export type ManualCashItemRaw = { readonly mode: 'values' | 'unavailable'; readonly values: Readonly<Record<YearMonth, string>>; readonly unavailableReason: string };
export type ManualCashRoundRaw = { readonly enabled: boolean; readonly asOfRaw: string; readonly items: Readonly<Record<ItemName, ManualCashItemRaw>> };
export type ManualBondRaw = { readonly averageRaw: string; readonly byAgencyRaw: Readonly<Record<Agency, string>> };
export type ManualFundingDayRaw = { readonly rowId: string; readonly dateRaw: string; readonly publicAaa: ManualBondRaw; readonly treasury: ManualBondRaw };
export type ManualEntryContentV1 = {
  readonly cashflow: Readonly<Record<YearMonth, ManualCashRoundRaw>>;
  readonly economic: Readonly<Record<EcosIndicatorKey, { readonly unitRaw: string; readonly values: Readonly<Record<YearMonth, string>> }>>;
  readonly funding: { readonly days: readonly ManualFundingDayRaw[]; readonly noDataReason: string };
  readonly note: string;
};
export type ManualEntryCatalogV1 = {
  readonly payloadVersion: 1; readonly reportCycle: YearMonth; readonly basis: ReportBasis; readonly calculationVersion: string; readonly templateVersion: string;
  readonly cashflow: readonly { readonly round: YearMonth; readonly role: 'forecast-plan' | 'previous' | 'current'; readonly isRequired: boolean; readonly months: readonly YearMonth[]; readonly planYearEnd: YearMonth; readonly unit: '억원' }[];
  readonly economic: readonly (ManualEconomicDefinition & { readonly currentMonth: YearMonth; readonly referenceMonth: YearMonth; readonly transform: ScoringRule['transform']; readonly unitInstruction: '단위·기준(두 기간 동일)' })[];
  readonly funding: { readonly observedMonth: YearMonth; readonly unit: '%'; readonly agencies: readonly Agency[] };
};
export type ManualEntryFieldError = { readonly category: 'cashflow' | 'economic' | 'funding' | 'general'; readonly round: YearMonth | null; readonly field: string; readonly code: string; readonly message: string };
export type ManualEntryInputSummary = {
  readonly includedRounds: readonly YearMonth[]; readonly omittedRounds: readonly YearMonth[];
  readonly unavailableItems: readonly { readonly round: YearMonth; readonly item: ItemName; readonly reason: string }[];
  readonly missingEconomic: readonly { readonly key: EcosIndicatorKey; readonly month: YearMonth }[];
  readonly fundingDates: readonly CalendarDate[];
  readonly fundingMissing: readonly { readonly date: CalendarDate; readonly bond: 'publicAaa' | 'treasury' }[];
};
export type ManualNormalizedStatement = { readonly asOf: { readonly year: number; readonly month: number; readonly day: number }; readonly monthLabels: readonly string[]; readonly baseMonthIndex: number; readonly planYearEndIndex: number; readonly amounts: Readonly<Record<ItemName, readonly number[] | Unreadable>> };
export type ManualNormalizedEconomicSeries = { readonly key: EcosIndicatorKey; readonly unit: string; readonly values: readonly { readonly month: YearMonth; readonly value: number }[] };
export type ManualEntryValidation = { readonly kind: 'valid'; readonly content: ManualEntryContentV1 } | { readonly kind: 'invalid'; readonly errors: readonly ManualEntryFieldError[] };
export type ManualEntryNormalization = { readonly kind: 'ready'; readonly statements: readonly ManualNormalizedStatement[]; readonly economic: readonly ManualNormalizedEconomicSeries[]; readonly yields: readonly DailyYields[]; readonly inputSummary: ManualEntryInputSummary } | { readonly kind: 'invalid'; readonly errors: readonly ManualEntryFieldError[] };
export type ManualEntryBinding = { readonly draftId: string; readonly draftRevision: number; readonly rawInputHash: string };
export type ManualEntryDependencyHead = { readonly reportCycle: YearMonth; readonly confirmationId: string | null; readonly revision: number };
export type ManualEntryReviewRef = ManualEntryBinding & { readonly candidateId: string; readonly documentHash: string; readonly preparedAt: string; readonly evaluatedAt: string; readonly dependencyHeads: readonly ManualEntryDependencyHead[] };
export type ManualEntrySourceMetadataV1 = ManualEntryBinding & { readonly kind: 'manual-input'; readonly payloadVersion: 1; readonly recordedAt: string; readonly statementSources: readonly { readonly round: YearMonth; readonly asOf: { readonly year: number; readonly month: number; readonly day: number }; readonly label: string }[]; readonly economicSource: 'user-entered-published-series'; readonly fundingSource: 'user-entered-published-averages'; readonly note: string; readonly inputSummary?: ManualEntryInputSummary };
export type StoredManualEntryDraft = { readonly recordKind: 'manual-entry-draft'; readonly payloadVersion: 1; readonly scopeId: string; readonly draftId: string; readonly reportCycle: YearMonth; readonly draftRevision: number; readonly catalog: ManualEntryCatalogV1; readonly content: ManualEntryContentV1; readonly rawInputHash: string; readonly createdAt: string; readonly savedAt: string; readonly currentReview: ManualEntryReviewRef | null; readonly confirmationId: string | null };
export type ManualEntryState = 'editing' | 'review-ready' | 'stale-review' | 'month-conflict' | 'confirmed';
export type ManualEntryDraftDto = Omit<StoredManualEntryDraft, 'scopeId'> & { readonly state: ManualEntryState; readonly existingConfirmation?: { readonly confirmationId: string; readonly revision: number }; readonly review?: { readonly ref: ManualEntryReviewRef; readonly document: PreparedDocument; readonly inputSummary: ManualEntryInputSummary } };
export type ManualEntrySummary = { readonly draftId: string; readonly reportCycle: YearMonth; readonly reportTitleMonth: YearMonth; readonly draftRevision: number; readonly savedAt: string; readonly state: Exclude<ManualEntryState, 'confirmed'>; readonly existingConfirmation?: { readonly confirmationId: string; readonly revision: number } };
export type CreateManualEntryCommand = { readonly reportTitleMonth: YearMonth; readonly idempotencyKey: string };
export type SaveManualEntryCommand = { readonly draftId: string; readonly expectedDraftRevision: number; readonly idempotencyKey: string; readonly content: ManualEntryContentV1 };
export type PrepareManualEntryCommand = { readonly draftId: string; readonly expectedDraftRevision: number; readonly idempotencyKey: string };
export type ConfirmManualEntryCommand = { readonly draftId: string; readonly expectedDraftRevision: number; readonly candidateId: string; readonly documentHash: string; readonly expectedRevision: 0; readonly idempotencyKey: string };

const ITEM_NAMES: readonly ItemName[] = ['기초시재', '수입계', '수입', '분양회수', '기타수입', '지출'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RAW_LENGTH = 2000;

export function createManualEntryCatalog(reportTitleMonth: YearMonth, definitions: readonly ManualEconomicDefinition[]): ManualEntryCatalogV1 {
  parseYearMonth(reportTitleMonth);
  const reportCycle = addMonths(reportTitleMonth, 1);
  const constructionBaseMonth = addMonths(reportCycle, -2);
  const rules = SCORING_RULES.filter((rule): rule is ScoringRule & { key: EcosIndicatorKey } => rule.key !== '분양회수예측오차');
  if (definitions.length !== rules.length || new Set(definitions.map(d => d.key)).size !== rules.length || rules.some(r => !definitions.some(d => d.key === r.key))) throw new Error('INVALID_ECONOMIC_DEFINITIONS');
  const rounds = [addMonths(reportCycle, -3), addMonths(reportCycle, -1), reportCycle];
  return {
    payloadVersion: 1, reportCycle,
    basis: { reportCycle, reportTitleMonth, constructionBaseMonth, fundingJudgedMonth: reportCycle, fundingObservedMonth: addMonths(reportCycle, -1), gapMonth: reportCycle },
    calculationVersion: HISTORY_CALCULATION_VERSION, templateVersion: HISTORY_TEMPLATE_VERSION,
    cashflow: rounds.map((round, index) => {
      const [year] = round.split('/').map(Number);
      const start = yearMonth(year, 1); const planYearEnd = yearMonth(year, 12);
      const forwardEnd = addMonths(round, 3); const end = forwardEnd > planYearEnd ? forwardEnd : planYearEnd;
      const months: YearMonth[] = [];
      for (let month = start; ; month = addMonths(month, 1)) {
        months.push(month);
        if (month === end) break;
      }
      return { round, role: (['forecast-plan', 'previous', 'current'] as const)[index], isRequired: index === 2, months, planYearEnd, unit: '억원' as const };
    }),
    economic: rules.map(rule => {
      const definition = definitions.find(d => d.key === rule.key)!;
      return { key: rule.key, name: definition.name, statistic: definition.statistic, items: [...definition.items], currentMonth: constructionBaseMonth, referenceMonth: addMonths(constructionBaseMonth, rule.transform === '전년동월비' ? -12 : -1), transform: rule.transform, unitInstruction: '단위·기준(두 기간 동일)' as const };
    }),
    funding: { observedMonth: addMonths(reportCycle, -1), unit: '%', agencies: [...AGENCIES] },
  };
}

export function createBlankManualEntryContent(catalog: ManualEntryCatalogV1): ManualEntryContentV1 {
  return {
    cashflow: Object.fromEntries(catalog.cashflow.map(c => [c.round, { enabled: c.isRequired, asOfRaw: '', items: Object.fromEntries(ITEM_NAMES.map(item => [item, { mode: 'values', values: Object.fromEntries(c.months.map(month => [month, ''])), unavailableReason: '' }])) }])) as ManualEntryContentV1['cashflow'],
    economic: Object.fromEntries(catalog.economic.map(c => [c.key, { unitRaw: '', values: { [c.currentMonth]: '', [c.referenceMonth]: '' } }])) as ManualEntryContentV1['economic'],
    funding: { days: [], noDataReason: '' }, note: '',
  };
}

function fieldError(field: string, code: string, message: string): ManualEntryFieldError {
  const section = field.split('.')[0];
  const category = section === 'cashflow' || section === 'economic' || section === 'funding' ? section : 'general';
  return { category, round: category === 'cashflow' && /^\d{4}\/\d{2}$/.test(field.split('.')[1] ?? '') ? field.split('.')[1] as YearMonth : null, field, code, message };
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }

/** Storage accepts unfinished numbers and dates, but never a different source shape. */
export function validateManualEntryContent(catalog: ManualEntryCatalogV1, input: unknown): ManualEntryValidation {
  const errors: ManualEntryFieldError[] = [];
  const fail = (field: string, code: string, message: string) => { errors.push(fieldError(field, code, message)); };
  const shape = (value: unknown, keys: readonly string[], field: string): value is Record<string, unknown> => {
    if (!object(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) { fail(field, 'INVALID_SHAPE', '정해진 입력 항목과 정확히 일치해야 합니다.'); return false; }
    return true;
  };
  const raw = (value: unknown, field: string) => { if (typeof value !== 'string' || value.length > MAX_RAW_LENGTH) fail(field, 'INVALID_RAW', '입력은 2000자 이하 문자열이어야 합니다.'); };
  const values = (value: unknown, months: readonly YearMonth[], field: string) => { if (shape(value, months, field)) for (const month of months) raw(value[month], `${field}.${month}`); };
  if (!shape(input, ['cashflow', 'economic', 'funding', 'note'], 'content')) return { kind: 'invalid', errors };
  raw(input.note, 'note');
  if (shape(input.cashflow, catalog.cashflow.map(c => c.round), 'cashflow')) for (const c of catalog.cashflow) {
    const field = `cashflow.${c.round}`; const round = input.cashflow[c.round];
    if (!shape(round, ['enabled', 'asOfRaw', 'items'], field)) continue;
    if (typeof round.enabled !== 'boolean') fail(`${field}.enabled`, 'INVALID_BOOLEAN', '회차 사용 여부를 선택하세요.');
    raw(round.asOfRaw, `${field}.asOfRaw`);
    if (!shape(round.items, ITEM_NAMES, `${field}.items`)) continue;
    for (const item of ITEM_NAMES) {
      const itemField = `${field}.items.${item}`; const value = round.items[item];
      if (!shape(value, ['mode', 'values', 'unavailableReason'], itemField)) continue;
      if (value.mode !== 'values' && value.mode !== 'unavailable') fail(`${itemField}.mode`, 'INVALID_MODE', '값 또는 항목 전체 자료 없음을 선택하세요.');
      raw(value.unavailableReason, `${itemField}.unavailableReason`); values(value.values, c.months, `${itemField}.values`);
    }
  }
  if (shape(input.economic, catalog.economic.map(c => c.key), 'economic')) for (const c of catalog.economic) {
    const field = `economic.${c.key}`; const series = input.economic[c.key];
    if (!shape(series, ['unitRaw', 'values'], field)) continue;
    raw(series.unitRaw, `${field}.unitRaw`); values(series.values, [c.currentMonth, c.referenceMonth], `${field}.values`);
  }
  const bond = (value: unknown, field: string) => {
    if (!shape(value, ['averageRaw', 'byAgencyRaw'], field)) return;
    raw(value.averageRaw, `${field}.averageRaw`);
    if (shape(value.byAgencyRaw, AGENCIES, `${field}.byAgencyRaw`)) for (const agency of AGENCIES) raw(value.byAgencyRaw[agency], `${field}.byAgencyRaw.${agency}`);
  };
  if (shape(input.funding, ['days', 'noDataReason'], 'funding')) {
    raw(input.funding.noDataReason, 'funding.noDataReason');
    if (!Array.isArray(input.funding.days) || input.funding.days.length > 31) fail('funding.days', 'INVALID_DAYS', '평가일은 최대 31개까지 입력할 수 있습니다.');
    else for (const [index, value] of input.funding.days.entries()) {
      const field = `funding.days.${index}`;
      if (!shape(value, ['rowId', 'dateRaw', 'publicAaa', 'treasury'], field)) continue;
      if (typeof value.rowId !== 'string' || !UUID.test(value.rowId)) fail(`${field}.rowId`, 'INVALID_ROW_ID', '평가일 행 식별자는 UUID여야 합니다.');
      raw(value.dateRaw, `${field}.dateRaw`); bond(value.publicAaa, `${field}.publicAaa`); bond(value.treasury, `${field}.treasury`);
    }
  }
  return errors.length ? { kind: 'invalid', errors } : { kind: 'valid', content: input as unknown as ManualEntryContentV1 };
}

/** No inference, unit conversion, zero filling, or published-average recomputation. */
export function normalizeManualEntry(catalog: ManualEntryCatalogV1, input: unknown): ManualEntryNormalization {
  const validation = validateManualEntryContent(catalog, input);
  if (validation.kind === 'invalid') return validation;
  const content = validation.content; const errors: ManualEntryFieldError[] = [];
  const fail = (field: string, code: string, message: string) => { errors.push(fieldError(field, code, message)); };
  const decimal = (raw: string, field: string, optional: boolean): number | null => {
    const text = raw.trim();
    if (!text && optional) return null;
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) { fail(field, 'INVALID_DECIMAL', '완성된 유한 십진수를 입력하세요.'); return null; }
    const value = Number(text);
    if (!Number.isFinite(value) || (value === 0 && /[1-9]/.test(text))) { fail(field, 'DECIMAL_OUT_OF_RANGE', '수치가 표현할 수 있는 범위를 벗어났습니다.'); return null; }
    return value;
  };
  const date = (raw: string, expected: YearMonth, field: string): CalendarDate | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    try {
      if (!match) throw new Error('INVALID_DATE');
      const parsed = calendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
      if (monthOfDate(parsed) !== expected) { fail(field, 'DATE_MONTH_MISMATCH', `기준일은 ${expected}의 실제 날짜여야 합니다.`); return null; }
      return parsed;
    } catch { fail(field, 'INVALID_DATE', '실제 유효한 날짜를 YYYY-MM-DD로 입력하세요.'); return null; }
  };
  const statements: ManualNormalizedStatement[] = []; const economic: ManualNormalizedEconomicSeries[] = []; const yields: DailyYields[] = [];
  const includedRounds: YearMonth[] = []; const omittedRounds: YearMonth[] = [];
  const unavailableItems: { round: YearMonth; item: ItemName; reason: string }[] = [];
  const missingEconomic: { key: EcosIndicatorKey; month: YearMonth }[] = [];
  const fundingDates: CalendarDate[] = []; const fundingMissing: { date: CalendarDate; bond: 'publicAaa' | 'treasury' }[] = [];
  for (const c of catalog.cashflow) {
    const field = `cashflow.${c.round}`; const round = content.cashflow[c.round];
    if (!round.enabled) { omittedRounds.push(c.round); if (c.isRequired) fail(`${field}.enabled`, 'CURRENT_ROUND_REQUIRED', '현재 자료회차는 필수입니다.'); continue; }
    includedRounds.push(c.round);
    const asOf = date(round.asOfRaw, c.round, `${field}.asOfRaw`);
    const amounts = {} as Record<ItemName, readonly number[] | Unreadable>; let unavailableCount = 0;
    for (const item of ITEM_NAMES) {
      const itemField = `${field}.items.${item}`; const value = round.items[item];
      if (value.mode === 'unavailable') {
        const reason = value.unavailableReason.trim(); unavailableCount++;
        if (!reason) fail(`${itemField}.unavailableReason`, 'UNAVAILABLE_REASON_REQUIRED', '항목 전체 자료 없음의 사유를 입력하세요.');
        amounts[item] = unreadable(reason); unavailableItems.push({ round: c.round, item, reason });
      } else {
        const series: number[] = [];
        for (const month of c.months) { const valueNumber = decimal(value.values[month], `${itemField}.values.${month}`, false); if (valueNumber !== null) series.push(valueNumber); }
        amounts[item] = series;
      }
    }
    if (unavailableCount === ITEM_NAMES.length) fail(`${field}.items`, 'ALL_ITEMS_UNAVAILABLE', '6개 항목 모두 자료 없음인 회차는 검토할 수 없습니다.');
    if (asOf !== null) {
      const [year, month, day] = asOf.split('/').map(Number);
      statements.push({ asOf: { year, month, day }, monthLabels: [...c.months], baseMonthIndex: c.months.indexOf(c.round), planYearEndIndex: c.months.indexOf(c.planYearEnd), amounts });
    }
  }
  for (const c of catalog.economic) {
    const field = `economic.${c.key}`; const raw = content.economic[c.key];
    const values: { month: YearMonth; value: number }[] = [];
    for (const month of [c.currentMonth, c.referenceMonth]) {
      if (!raw.values[month].trim()) missingEconomic.push({ key: c.key, month });
      const value = decimal(raw.values[month], `${field}.values.${month}`, true);
      if (value !== null) values.push({ month, value });
    }
    if ([c.currentMonth, c.referenceMonth].some(month => raw.values[month].trim()) && !raw.unitRaw.trim()) fail(`${field}.unitRaw`, 'UNIT_REQUIRED', '값이 있는 지표의 단위·기준을 입력하세요.');
    if (values.length || raw.unitRaw.trim()) economic.push({ key: c.key, unit: raw.unitRaw.trim(), values });
  }
  if (!content.funding.days.length && !content.funding.noDataReason.trim()) fail('funding.noDataReason', 'NO_DATA_REASON_REQUIRED', '평가일이 없으면 자료 없음 사유를 입력하세요.');
  const rowIds = new Set<string>(); const dates = new Set<CalendarDate>();
  for (const [index, raw] of content.funding.days.entries()) {
    const field = `funding.days.${index}`;
    if (rowIds.has(raw.rowId.toLowerCase())) fail(`${field}.rowId`, 'DUPLICATE_ROW_ID', '평가일 행 식별자가 중복되었습니다.'); rowIds.add(raw.rowId.toLowerCase());
    const parsed = date(raw.dateRaw, catalog.funding.observedMonth, `${field}.dateRaw`);
    if (parsed !== null) { if (dates.has(parsed)) fail(`${field}.dateRaw`, 'DUPLICATE_DATE', '같은 평가일은 한 번만 입력하세요.'); dates.add(parsed); fundingDates.push(parsed); }
    const normalizeBond = (value: ManualBondRaw, bond: 'publicAaa' | 'treasury'): BondYield => {
      const average = decimal(value.averageRaw, `${field}.${bond}.averageRaw`, true);
      const byAgency = Object.fromEntries(AGENCIES.map(agency => [agency, decimal(value.byAgencyRaw[agency], `${field}.${bond}.byAgencyRaw.${agency}`, true)])) as Record<Agency, number | null>;
      if (parsed !== null && average === null) fundingMissing.push({ date: parsed, bond });
      return { average, byAgency };
    };
    const publicAaa = normalizeBond(raw.publicAaa, 'publicAaa'); const treasury = normalizeBond(raw.treasury, 'treasury');
    if (parsed !== null) yields.push({ date: parsed, publicAaa, treasury });
  }
  return errors.length ? { kind: 'invalid', errors } : { kind: 'ready', statements, economic, yields, inputSummary: { includedRounds, omittedRounds, unavailableItems, missingEconomic, fundingDates, fundingMissing } };
}

/** Semantic command identity excludes the retry key and all server-generated fields. */
export function manualEntryRequestHashInput(action: 'create' | 'save' | 'prepare' | 'confirm', command: CreateManualEntryCommand | SaveManualEntryCommand | PrepareManualEntryCommand | ConfirmManualEntryCommand): object {
  if (action === 'create' && 'reportTitleMonth' in command) return { action, reportTitleMonth: command.reportTitleMonth };
  if (action === 'save' && 'content' in command) return { action, draftId: command.draftId, expectedDraftRevision: command.expectedDraftRevision, content: command.content };
  if (action === 'prepare' && 'draftId' in command) return { action, draftId: command.draftId, expectedDraftRevision: command.expectedDraftRevision };
  if (action === 'confirm' && 'candidateId' in command) return { action, draftId: command.draftId, expectedDraftRevision: command.expectedDraftRevision, candidateId: command.candidateId, documentHash: command.documentHash, expectedRevision: command.expectedRevision };
  throw Error('INVALID_MANUAL_COMMAND');
}
