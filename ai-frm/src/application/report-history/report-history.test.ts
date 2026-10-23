import { describe, expect, it } from 'vitest';
import { captureFunding, captureConstruction } from './report-history';
import type { HistoryDependencies, HistoryRepository } from './ports';
import { assessFundingRiskReport } from '../funding-risk';
import { assessPerception } from '../construction-perception';
import { emptyLedger } from '../../domain/cashflow/forecast-ledger';
import { SCORING_RULES } from '../../domain/risk/construction-perception/policy';
import type { EconomicIndicatorSource, BondYieldSource, SourceResult, YieldFetch } from '../ports';
import type { CapturedSource, SourceObservation } from './ports';

const date = (iso: string) => new Date(iso);
function captured<S extends EconomicIndicatorSource | BondYieldSource, T extends SourceResult | YieldFetch>(source: S, method: 'fetchAll' | 'dailyYields'): CapturedSource<S, T> {
  let seen: SourceObservation<T> = { kind: 'not-requested' };
  const run = async (fetch: () => Promise<T>): Promise<T> => {
    try {
      const value = await fetch();
      seen = { kind: 'returned', value };
      return value;
    } catch (error) {
      seen = error instanceof Error
        ? { kind: 'threw', errorKind: 'error', message: error.message }
        : { kind: 'threw', errorKind: 'non-error' };
      throw error;
    }
  };
  const wrapped = method === 'fetchAll'
    ? { fetchAll: () => run(() => (source as EconomicIndicatorSource).fetchAll() as Promise<T>) }
    : { dailyYields: (month: never) => run(() => (source as BondYieldSource).dailyYields(month) as Promise<T>) };
  return { source: wrapped as unknown as S, observation: () => seen };
}
function fixture() {
  const evidence: unknown[] = [], calculations: unknown[] = [];
  const repo = {
    putEvidence: async (x: unknown) => { evidence.push(x); return { captureId: `e${evidence.length}` }; },
    putCalculation: async (x: unknown) => { calculations.push(x); return { calculationId: `c${calculations.length}` }; },
  } as unknown as HistoryRepository;
  const deps: HistoryDependencies = {
    repository: repo,
    indicators: { fetchAll: async () => ({}) as never },
    yields: { dailyYields: async () => ({ days: [], fetchedAt: date('2026-08-01T00:00:00Z') }) },
    clock: () => date('2026-09-28T03:00:00Z'),
    metadataClock: () => date('2026-10-01T00:00:00Z'),
    hash: value => JSON.stringify(value),
    encode: value => value as never,
    calculationVersion: 'test',
    captureIndicators: source => captured(source, 'fetchAll'),
    captureYields: source => captured(source, 'dailyYields'),
    isUnsafe: () => false,
  };
  return { deps, evidence, calculations };
}

describe('history capture', () => {
  it('preserves the original funding outcome and stores observed month', async () => {
    const f = fixture();
    const request = { judgedMonth: '2026/08' as never };
    const before = await assessFundingRiskReport(f.deps.yields, request, f.deps.clock);
    const after = await captureFunding(f.deps, 'scope', request);
    expect(after.outcome).toEqual(before);
    expect(after.history).toMatchObject({ captureStatus: 'saved', calculationId: 'c1' });
    expect(f.calculations[0]).toMatchObject({ indicator: 'funding', effectiveMonth: '2026/07', evaluationClockTrace: ['2026-09-28T03:00:00.000Z'], captureIds: ['e1'] });
  });

  it('does not invent a source receipt when the future guard avoids fetching', async () => {
    const f = fixture();
    const after = await captureFunding(f.deps, 'scope', { judgedMonth: '2026/10' as never });
    expect(after.history.captureStatus).toBe('saved');
    expect(f.evidence).toHaveLength(0);
    expect(f.calculations[0]).toMatchObject({ captureIds: [], effectiveMonth: '2026/09' });
  });

  it('keeps the original outcome on storage failure', async () => {
    const f = fixture();
    f.deps = { ...f.deps, repository: { ...f.deps.repository, putCalculation: async () => { throw Error('disk down'); } } };
    const request = { judgedMonth: '2026/08' as never };
    const before = await assessFundingRiskReport(f.deps.yields, request, f.deps.clock);
    const after = await captureFunding(f.deps, 'scope', request);
    expect(after.outcome).toEqual(before);
    expect(after.history).toEqual({ captureStatus: 'failed', code: 'STORAGE_UNAVAILABLE' });
  });

  it('records construction report month 08 as effective month 06 without changing the result', async () => {
    const f = fixture();
    const ledger = emptyLedger(), request = { reportMonth: '2026/08' as never };
    const before = await assessPerception(f.deps.indicators, ledger, request, f.deps.clock);
    const after = await captureConstruction(f.deps, 'scope', request, ledger);
    expect(after.outcome).toEqual(before);
    expect(f.calculations[0]).toMatchObject({ indicator: 'construction', effectiveMonth: '2026/06' });
  });

  it('records both original clock calls when ECOS data has no fetchedAt', async () => {
    const f = fixture();
    let calls = 0;
    const allErrors = Object.fromEntries(SCORING_RULES.filter(rule => rule.key !== '분양회수예측오차').map(rule => [rule.key, { error: 'offline' }]));
    f.deps = { ...f.deps, indicators: { fetchAll: async () => allErrors as never }, clock: () => date(calls++ ? '2026-09-28T03:00:01Z' : '2026-09-28T03:00:00Z') };
    await captureConstruction(f.deps, 'scope', { reportMonth: '2026/08' as never }, emptyLedger());
    expect(calls).toBe(2);
    expect(f.calculations[0]).toMatchObject({ evaluationClockTrace: ['2026-09-28T03:00:00.000Z', '2026-09-28T03:00:01.000Z'] });
  });

  it('snapshots a reused mutable Date at each call across a month boundary', async () => {
    const f = fixture();
    const first = new Date(2026, 8, 30, 23, 59, 59);
    const second = new Date(2026, 9, 1, 0, 0, 0);
    const allErrors = Object.fromEntries(SCORING_RULES.filter(rule => rule.key !== '분양회수예측오차').map(rule => [rule.key, { error: 'offline' }]));
    let sourceCalls = 0;
    const indicators: EconomicIndicatorSource = { fetchAll: async () => { sourceCalls++; return allErrors as never; } };
    const mutableClock = () => {
      const shared = new Date(first);
      let calls = 0;
      return () => {
        if (calls++ > 0) shared.setTime(second.getTime());
        return shared;
      };
    };
    const baseline = await assessPerception(indicators, emptyLedger(), {}, mutableClock());
    sourceCalls = 0;
    f.deps = { ...f.deps, indicators, clock: mutableClock() };
    const after = await captureConstruction(f.deps, 'scope', {}, emptyLedger());
    expect(after.outcome).toEqual(baseline);
    expect(sourceCalls).toBe(1);
    expect(after.history.captureStatus).toBe('saved');
    expect(f.calculations[0]).toMatchObject({
      effectiveMonth: '2026/07',
      evaluatedAt: first.toISOString(),
      evaluationClockTrace: [first.toISOString(), second.toISOString()],
      evaluatedCalendar: { year: first.getFullYear(), month: first.getMonth() + 1, day: first.getDate() },
    });
  });

  it('records an original failure Outcome with validated request context', async () => {
    const f = fixture();
    f.deps = { ...f.deps, indicators: { fetchAll: async () => ({ x: { error: 'offline' } }) as never } };
    const after = await captureConstruction(f.deps, 'scope', { reportMonth: '2026/08' as never }, emptyLedger());
    expect(after.outcome.ok).toBe(false);
    expect(after.history.captureStatus).toBe('saved');
    expect(f.calculations[0]).toMatchObject({ effectiveMonth: '2026/06', requestContext: { request: { reportMonth: '2026/08' }, sourceState: 'returned' } });
  });

});
