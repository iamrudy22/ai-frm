import { describe, expect, it } from 'vitest';
import { createStatement, calendarOf } from '../../domain/cashflow/statement';
import { amount } from '../../domain/shared/amount';
import { snapshotStatement, restoreStatement } from './report-candidate';

const amounts = { 기초시재: [1, 2], 수입계: [3, 4], 수입: [5, 6], 분양회수: [7, 8], 기타수입: [9, 10], 지출: [11, 12] };
const branded = Object.fromEntries(Object.entries(amounts).map(([key, values]) => [key, values.map(amount)])) as unknown as Parameters<typeof createStatement>[0]['amounts'];

describe('report candidate statement snapshot', () => {
  it.each([[2026, 1, 1], [2026, 12, 31]])('preserves a local calendar day across the year edge (%i/%i/%i)', (year, month, day) => {
    const original = createStatement({ asOf: new Date(year, month - 1, day), monthLabels: ['전월', '기준월'], baseMonthIndex: 1, planYearEndIndex: 1, amounts: branded });
    const restored = restoreStatement(snapshotStatement(original));
    expect(snapshotStatement(restored)).toEqual(snapshotStatement(original));
    expect(calendarOf(restored, restored.defaultBaseMonth)).toBe(`${year}/${String(month).padStart(2, '0')}`);
  });
  it('rejects sparse, nonfinite, or extra amount fields before storing', () => {
    const original = createStatement({ asOf: new Date(2026, 0, 1), monthLabels: ['전월', '기준월'], baseMonthIndex: 1, planYearEndIndex: 1, amounts: branded });
    const dto = snapshotStatement(original);
    expect(() => restoreStatement({ ...dto, amounts: { ...dto.amounts, 지출: [1, Number.POSITIVE_INFINITY] } })).toThrow('INVALID_STATEMENT');
    expect(() => restoreStatement({ ...dto, amounts: { ...dto.amounts, 지출: [1] } })).toThrow('INVALID_STATEMENT');
    expect(() => restoreStatement({ ...dto, asOf: { year: 2026, month: 2, day: 30 } })).toThrow('INVALID_STATEMENT');
    expect(() => restoreStatement({ ...dto, monthLabels: Array(2) as string[] })).toThrow('INVALID_STATEMENT');
  });
  it('round-trips a valid 37-month statement and a pre-1900 calendar date', () => {
    const longAmounts = Object.fromEntries(Object.keys(amounts).map(key => [key, Array.from({ length: 37 }, (_, index) => amount(index + 1))])) as unknown as Parameters<typeof createStatement>[0]['amounts'];
    const long = createStatement({ asOf: new Date(2026, 7, 1), monthLabels: Array.from({ length: 37 }, (_, index) => `월 ${index + 1}`),
      baseMonthIndex: 1, planYearEndIndex: 36, amounts: longAmounts });
    expect(snapshotStatement(restoreStatement(snapshotStatement(long)))).toEqual(snapshotStatement(long));
    const historical = createStatement({ asOf: new Date(1899, 11, 31), monthLabels: ['전월', '기준월'],
      baseMonthIndex: 1, planYearEndIndex: 1, amounts: branded });
    expect(snapshotStatement(restoreStatement(snapshotStatement(historical)))).toEqual(snapshotStatement(historical));
  });
});
