import { describe, expect, it } from 'vitest';
import { planBackfill } from './historical-risk-backfill';
import { parseYearMonth } from '../../domain/shared/year-month';

describe('historical risk backfill planning', () => {
  it('uses the requested report cycles and surfaces the exact missing local rounds', () => {
    const plan = planBackfill({ fromCycle: parseYearMonth('2026/08'), toCycle: parseYearMonth('2026/08'), rounds: [{ round: '2026/09', sheetStart: '2026/09', actuals: [], plans: [
      { month: '2026/09', value: 1 }, { month: '2026/10', value: 1 }, { month: '2026/11', value: 1 }, { month: '2026/12', value: 1 },
    ] }] });
    expect(plan.cycles).toEqual(['2026/08']);
    expect(plan.readiness[0].constructionBaseMonth).toBe('2026/06');
    expect(plan.readiness[0].missingRounds).toEqual(['2026/05', '2026/08']);
  });
  it('requires an uploaded anchor, caps the span at 18, and keeps a zero plan as a specific missing reason', () => {
    const ym = parseYearMonth;
    expect(() => planBackfill({ fromCycle: ym('2026/08'), toCycle: ym('2026/08'), rounds: [] })).toThrow('NO_REPORT_CYCLE');
    const planRound = { round: '2026/05', sheetStart: '2026/05', actuals: [], plans: ['05', '06', '07', '08'].map(month => ({ month: `2026/${month}`, value: 0 })) };
    const actualRound = { round: '2026/08', sheetStart: '2026/08', actuals: [], plans: ['08', '09', '10', '11'].map(month => ({ month: `2026/${month}`, value: 1 })) };
    const plan = planBackfill({ fromCycle: ym('2026/08'), toCycle: ym('2026/08'), rounds: [planRound, actualRound] });
    expect(plan.readiness[0].localReason).toContain('실적 열이 없습니다');
    const actuals = ['05', '06', '07'].map(month => ({ month: `2026/${month}`, value: 1 }));
    const complete = planBackfill({ fromCycle: ym('2026/08'), toCycle: ym('2026/08'), rounds: [planRound, { ...actualRound, sheetStart: '2026/05', actuals }] });
    expect(complete.readiness[0].localReason).toContain('계획 합이 0');
    expect(() => planBackfill({ fromCycle: ym('2025/01'), toCycle: ym('2026/08'), rounds: [actualRound] })).toThrow('LIMIT_EXCEEDED');
  });
  it('shows the previous-year actual column absence without substituting later rounds', () => {
    const ym = parseYearMonth;
    const octoberPlan = { round: '2025/10', sheetStart: '2025/10', actuals: [], plans: ['2025/10', '2025/11', '2025/12', '2026/01'].map(month => ({ month, value: 100 })) };
    const januaryActual = { round: '2026/01', sheetStart: '2026/01', actuals: [], plans: ['2026/01', '2026/02', '2026/03', '2026/04'].map(month => ({ month, value: 100 })) };
    const plan = planBackfill({ fromCycle: ym('2026/01'), toCycle: ym('2026/01'), rounds: [octoberPlan, januaryActual] });
    expect(plan.readiness[0].missingRounds).toEqual([]);
    expect(plan.readiness[0].localReason).toContain('2025/10 실적 열이 없습니다');
  });
});
