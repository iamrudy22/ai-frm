import { describe, expect, it } from 'vitest';
import type { IndicatorFetch } from '../../application/ports';
import { calendarOf, createStatement, type ItemName } from '../cashflow/statement';
import { SCORING_RULES } from '../risk/construction-perception/policy';
import { yearMonth, type YearMonth } from '../shared/year-month';
import { createBlankManualEntryContent, createManualEntryCatalog, normalizeManualEntry, validateManualEntryContent, type ManualEconomicDefinition, type ManualEntryContentV1 } from './manual-entry';
const definitions: ManualEconomicDefinition[] = SCORING_RULES.filter(r => r.key !== '분양회수예측오차').map((r, i) => ({ key: r.key as ManualEconomicDefinition['key'], name: `합성 ${r.key}`, statistic: `STAT${i}`, items: [`ITEM${i}`] }));
const catalog = () => createManualEntryCatalog(yearMonth(2026, 12), definitions);
const items: ItemName[] = ['기초시재', '수입계', '수입', '분양회수', '기타수입', '지출'];
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function blank() { return structuredClone(createBlankManualEntryContent(catalog())) as Mutable<ManualEntryContentV1>; }
function ready() {
  const content = blank(); content.cashflow['2027/01' as YearMonth].asOfRaw = '2027-01-23';
  for (const item of items) for (const month of catalog().cashflow[2].months) content.cashflow['2027/01' as YearMonth].items[item].values[month] = '1';
  content.funding.noDataReason = '공표 자료를 확보하지 못함'; return content;
}
const row = (rowId = '11111111-1111-4111-8111-111111111111', dateRaw = '2026-12-30') => ({ rowId, dateRaw, publicAaa: { averageRaw: '3.123', byAgencyRaw: { 나이스피앤아이: '1', 한국자산평가: '9', KIS자산평가: '' } }, treasury: { averageRaw: '', byAgencyRaw: { 나이스피앤아이: '', 한국자산평가: '', KIS자산평가: '' } } });
describe('최초 직접 입력 catalog', () => {
  it('유효한 마지막 네 자리 연도의 달력은 마지막 열 다음 달을 생성하지 않는다', () => {
    const c = createManualEntryCatalog(yearMonth(9999, 8), definitions);
    expect(c.cashflow[2].months.at(-1)).toBe('9999/12');
  });
  it('보고월 12월은 다음 해 1월 자료회차와 canonical basis 및 세 회차 달력을 고정한다', () => {
    const c = catalog();
    expect(c.basis).toEqual({ reportCycle: '2027/01', reportTitleMonth: '2026/12', constructionBaseMonth: '2026/11', fundingJudgedMonth: '2027/01', fundingObservedMonth: '2026/12', gapMonth: '2027/01' });
    expect(c.reportCycle).toBe('2027/01');
    expect(c.cashflow.map(r => [r.round, r.role, r.isRequired])).toEqual([['2026/10', 'forecast-plan', false], ['2026/12', 'previous', false], ['2027/01', 'current', true]]);
    expect(c.cashflow.map(r => [r.months[0], r.months.at(-1), r.months.length, r.planYearEnd])).toEqual([['2026/01', '2027/01', 13, '2026/12'], ['2026/01', '2027/03', 15, '2026/12'], ['2027/01', '2027/12', 12, '2027/12']]);
  });
  it('9개 중립 정의를 정책 순서와 비교월에 연결하고 주입받은 식별 정보를 보존한다', () => {
    const c = catalog(); expect(c.economic).toHaveLength(9);
    expect(c.economic[0]).toMatchObject({ key: '총수주액', currentMonth: '2026/11', referenceMonth: '2025/11', statistic: 'STAT0', items: ['ITEM0'], name: '합성 총수주액' });
    expect(c.economic[1]).toMatchObject({ currentMonth: '2026/11', referenceMonth: '2026/10' });
    expect(c.funding).toMatchObject({ observedMonth: '2026/12', unit: '%' });
    expect(() => createManualEntryCatalog(yearMonth(2026, 12), definitions.slice(1))).toThrow();
    expect(() => createManualEntryCatalog(yearMonth(2026, 12), [...definitions, definitions[0]])).toThrow();
  });
  it('blank helper는 필수 회차만 활성화하고 빈 경제 키 모두를 새 객체로 만든다', () => {
    const content = blank(); expect(Object.values(content.cashflow).map(r => r.enabled)).toEqual([false, false, true]);
    expect(Object.keys(content.economic)).toHaveLength(9);
    expect(content.cashflow['2027/01' as YearMonth].items.수입계.values['2027/01' as YearMonth]).toBe('');
    expect(content.funding).toEqual({ days: [], noDataReason: '' }); content.note = '변경'; expect(blank().note).toBe('');
  });
});
describe('미완성 raw 구조 저장 경계', () => {
  it('빈 초안과 입력 중 숫자·날짜를 원문으로 저장하지만 검토는 거절한다', () => {
    const content = blank(); content.cashflow['2027/01' as YearMonth].asOfRaw = '2027-0'; content.cashflow['2027/01' as YearMonth].items.수입.values['2027/01' as YearMonth] = '-'; content.economic.대출금리.values['2026/11' as YearMonth] = '1.';
    expect(validateManualEntryContent(catalog(), content)).toEqual({ kind: 'valid', content }); expect(normalizeManualEntry(catalog(), content).kind).toBe('invalid');
  });
  it.each([
    (v: ReturnType<typeof blank>) => { (v as unknown as Record<string, unknown>).score = 3; },
    (v: ReturnType<typeof blank>) => { delete (v.economic as Partial<typeof v.economic>).환율; },
    (v: ReturnType<typeof blank>) => { (v.cashflow as Record<string, unknown>)['2027/02'] = {}; },
    (v: ReturnType<typeof blank>) => { delete (v.cashflow['2027/01' as YearMonth].items as Partial<Record<ItemName, unknown>>).수입; },
    (v: ReturnType<typeof blank>) => { v.cashflow['2027/01' as YearMonth].items.수입.values['2026/12' as YearMonth] = '0'; },
    (v: ReturnType<typeof blank>) => { v.note = 'x'.repeat(2001); },
    (v: ReturnType<typeof blank>) => { v.economic.환율.unitRaw = 'x'.repeat(2001); },
    (v: ReturnType<typeof blank>) => { v.cashflow['2027/01' as YearMonth].items.수입.values['2027/01' as YearMonth] = 'x'.repeat(2001); },
    (v: ReturnType<typeof blank>) => { v.funding.days = Array.from({ length: 32 }, () => row()); },
    (v: ReturnType<typeof blank>) => { v.funding.days = [row('invalid')]; },
    (v: ReturnType<typeof blank>) => { (v.funding as unknown as Record<string, unknown>).clock = 'spoofed'; },
  ])('알 수 없는 키·누락된 정확한 키·길이·목록·UUID 위반을 저장부터 거절한다 (%#)', change => {
    const content = blank(); change(content); expect(validateManualEntryContent(catalog(), content).kind).toBe('invalid');
  });
  it('primitive와 잘못된 nested 구조도 예외 없이 오류를 반환하고 2000자는 허용한다', () => {
    for (const input of [null, [], 1, { cashflow: null }, { ...blank(), economic: [] }]) expect(validateManualEntryContent(catalog(), input).kind).toBe('invalid');
    const content = blank(); content.note = 'x'.repeat(2000); expect(validateManualEntryContent(catalog(), content).kind).toBe('valid');
  });
});
describe('최초 입력 정규화', () => {
  it('선택 회차를 제외하고 기준일·달력·인덱스를 기존 Statement로 복원한다', () => {
    const result = normalizeManualEntry(catalog(), ready()); expect(result.kind).toBe('ready'); if (result.kind !== 'ready') return;
    expect(result.statements).toHaveLength(1); const snapshot = result.statements[0]; expect(snapshot.asOf).toEqual({ year: 2027, month: 1, day: 23 }); expect(snapshot.baseMonthIndex).toBe(0); expect(snapshot.planYearEndIndex).toBe(11);
    const statement = createStatement({ ...snapshot, asOf: new Date(2027, 0, 23), amounts: snapshot.amounts as Parameters<typeof createStatement>[0]['amounts'] });
    expect(statement.months.map(m => calendarOf(statement, m))).toEqual(['2027/01','2027/02','2027/03','2027/04','2027/05','2027/06','2027/07','2027/08','2027/09','2027/10','2027/11','2027/12']);
    expect(result.inputSummary.omittedRounds).toEqual(['2026/10', '2026/12']); expect(result.economic).toEqual([]); expect(result.inputSummary.missingEconomic).toHaveLength(18); expect(result.yields).toEqual([]);
  });
  it('선택 회차 활성화 시 모든 열과 그 회차의 실제 기준일을 요구한다', () => {
    const content = ready(); const previous = content.cashflow['2026/12' as YearMonth]; previous.enabled = true; expect(normalizeManualEntry(catalog(), content).kind).toBe('invalid'); previous.asOfRaw = '2026-12-17';
    for (const item of items) for (const month of catalog().cashflow[1].months) previous.items[item].values[month] = '0';
    const result = normalizeManualEntry(catalog(), content); expect(result.kind).toBe('ready'); if (result.kind !== 'ready') return;
    expect(result.statements[0]).toMatchObject({ baseMonthIndex: 11, planYearEndIndex: 11 }); expect(result.statements[0].monthLabels.at(-1)).toBe('2027/03');
  });
  it('공백/0/음수/앞자리 0/정밀도를 구분하고 수입계를 별도 원값으로 보존한다', () => {
    const content = ready(); const values = content.cashflow['2027/01' as YearMonth].items.수입계.values; values['2027/01' as YearMonth] = ' 0000 '; values['2027/02' as YearMonth] = '-012.3456789012345';
    const result = normalizeManualEntry(catalog(), content); expect(result.kind).toBe('ready'); if (result.kind !== 'ready') return;
    expect((result.statements[0].amounts.수입계 as readonly number[]).slice(0, 2)).toEqual([0, -12.3456789012345]); expect(values['2027/01' as YearMonth]).toBe(' 0000 '); values['2027/01' as YearMonth] = ' '; expect(normalizeManualEntry(catalog(), content).kind).toBe('invalid');
  });
  it.each(['NaN', 'Infinity', '0x10', '1e3', '12abc', '1,000', '1.', '9'.repeat(310), `0.${'0'.repeat(400)}1`])('비십진수/overflow/underflow를 검토 거절한다 (%#)', value => {
    const content = ready(); content.economic.환율.unitRaw = '원'; content.economic.환율.values['2026/11' as YearMonth] = value; expect(normalizeManualEntry(catalog(), content).kind).toBe('invalid');
  });
  it('whole unavailable은 사유와 raw를 남기고 6행 전체 unavailable은 거절한다', () => {
    const content = ready(); const current = content.cashflow['2027/01' as YearMonth]; current.items.수입.mode = 'unavailable'; current.items.수입.unavailableReason = '  원자료 없음  '; current.items.수입.values['2027/01' as YearMonth] = '-';
    const result = normalizeManualEntry(catalog(), content); expect(result.kind).toBe('ready'); if (result.kind !== 'ready') return;
    expect(result.statements[0].amounts.수입).toEqual({ unreadable: '원자료 없음' }); expect(result.inputSummary.unavailableItems).toEqual([{ round: '2027/01', item: '수입', reason: '원자료 없음' }]); expect(current.items.수입.values['2027/01' as YearMonth]).toBe('-');
    current.items.수입.unavailableReason = ''; expect(normalizeManualEntry(catalog(), content).kind).toBe('invalid');
    for (const item of items) { current.items[item].mode = 'unavailable'; current.items[item].unavailableReason = '없음'; }
    expect(normalizeManualEntry(catalog(), content)).toMatchObject({ kind: 'invalid', errors: expect.arrayContaining([expect.objectContaining({ code: 'ALL_ITEMS_UNAVAILABLE' })]) }); expect(validateManualEntryContent(catalog(), content).kind).toBe('valid');
  });
  it.each(['2027-02-01', '2027-01-32', '2027-02-29', '2027-01-00', '2027/01/01', '2027-1-01'])('실제 날짜와 회차를 확인하고 기준일을 추정하지 않는다: %s', date => {
    const content = ready(); content.cashflow['2027/01' as YearMonth].asOfRaw = date; expect(normalizeManualEntry(catalog(), content).kind).toBe('invalid');
  });
  it('두 기간이 공란이어도 단위 메타데이터를 보존하여 빈 SourceResult Map으로 연결한다', () => {
    const content = ready(); content.economic.대출금리.unitRaw = '  공표 원금리 %  ';
    const result = normalizeManualEntry(catalog(), content); expect(result.kind).toBe('ready'); if (result.kind !== 'ready') return;
    expect(result.economic).toEqual([{ key: '대출금리', unit: '공표 원금리 %', values: [] }]);
    expect(result.inputSummary.missingEconomic).toHaveLength(18);
    expect(result.inputSummary.missingEconomic).toContainEqual({ key: '대출금리', month: '2026/11' });
    expect(result.inputSummary.missingEconomic).toContainEqual({ key: '대출금리', month: '2026/10' });
    const series = result.economic[0];
    const source: IndicatorFetch = { unit: series.unit, values: new Map(series.values.map(value => [value.month, value.value])) };
    expect(source.unit).toBe('공표 원금리 %'); expect(source.values.size).toBe(0);
    content.economic.대출금리.unitRaw = '  ';
    const omitted = normalizeManualEntry(catalog(), content); expect(omitted.kind).toBe('ready'); if (omitted.kind !== 'ready') return;
    expect(omitted.economic).toEqual([]); expect(omitted.inputSummary.missingEconomic).toHaveLength(18);
  });
  it('현재 회차 비활성을 거절하고 값이 있는 경제지표의 공통 단위가 필수다', () => {
    const content = ready(); content.cashflow['2027/01' as YearMonth].enabled = false; expect(normalizeManualEntry(catalog(), content).kind).toBe('invalid'); content.cashflow['2027/01' as YearMonth].enabled = true;
    content.economic.대출금리.values['2026/11' as YearMonth] = '-0.1256789'; expect(normalizeManualEntry(catalog(), content).kind).toBe('invalid'); content.economic.대출금리.unitRaw = '  공표 원금리 %  ';
    const result = normalizeManualEntry(catalog(), content); expect(result.kind).toBe('ready'); if (result.kind !== 'ready') return;
    expect(result.economic).toEqual([{ key: '대출금리', unit: '공표 원금리 %', values: [{ month: '2026/11', value: -0.1256789 }] }]); expect(result.inputSummary.missingEconomic).toContainEqual({ key: '대출금리', month: '2026/10' });
  });
  it('평가일 없음은 사유가 필수이고 공표 평균 결측은 null이며 평가사로 재평균하지 않는다', () => {
    const content = ready(); content.funding.noDataReason = ''; expect(normalizeManualEntry(catalog(), content).kind).toBe('invalid'); content.funding.days = [row()];
    const result = normalizeManualEntry(catalog(), content); expect(result.kind).toBe('ready'); if (result.kind !== 'ready') return;
    expect(result.yields[0]).toMatchObject({ date: '2026/12/30', publicAaa: { average: 3.123, byAgency: { 나이스피앤아이: 1, 한국자산평가: 9, KIS자산평가: null } }, treasury: { average: null } }); expect(result.inputSummary.fundingMissing).toEqual([{ date: '2026/12/30', bond: 'treasury' }]); expect(result.inputSummary.fundingDates).toEqual(['2026/12/30']);
  });
  it('중복 날짜/rowId·잘못된 평가일·평가사 숫자를 거절한다', () => {
    for (const days of [[row(), row('22222222-2222-4222-8222-222222222222')], [row(), row(undefined, '2026-12-29')], [row(undefined, '2026-11-30')], [row(undefined, '2026-12-32')], [row(undefined, '')]]) { const content = ready(); content.funding.days = days; expect(normalizeManualEntry(catalog(), content).kind).toBe('invalid'); }
    const content = ready(); content.funding.days = [row()]; content.funding.days[0].publicAaa.byAgencyRaw.KIS자산평가 = 'abc'; expect(normalizeManualEntry(catalog(), content).kind).toBe('invalid');
  });
});
