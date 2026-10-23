import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assessPerception } from '../../application/construction-perception';
import { assessFundingRiskReport } from '../../application/funding-risk';
import { startBackfill, runBackfillStep, BackfillRetryError } from '../../application/report-history/historical-risk-backfill';
import type { HistoryDependencies } from '../../application/report-history/ports';
import type { EconomicIndicatorSource, BondYieldSource, SourceResult } from '../../application/ports';
import { ledgerOf } from '../../domain/cashflow/forecast-ledger';
import { SCORING_RULES } from '../../domain/risk/construction-perception/policy';
import { addMonths, compareYearMonth, parseYearMonth, type YearMonth } from '../../domain/shared/year-month';
import { parseCalendarDate } from '../../domain/shared/calendar-date';
import { SqliteHistoryRepository, hashHistoryValue, HISTORY_CALCULATION_VERSION } from './sqlite-history-repository';
import { evidenceToJson, evidenceFromJson } from './evidence-codec';
import { captureEconomicSource, captureBondSource, replayEconomicSource, replayBondSource } from './captured-sources';

const ym = parseYearMonth;
const fixed = new Date('2026-10-23T00:00:00.000Z');
const dirs: string[] = [];
const repos: SqliteHistoryRepository[] = [];
function open(path?: string) {
  if (!path) { const dir = mkdtempSync(join(tmpdir(), 'aifrm-backfill-')); dirs.push(dir); path = join(dir, 'history.sqlite'); }
  const repo = new SqliteHistoryRepository(path); repos.push(repo); return repo;
}
afterEach(() => { repos.splice(0).forEach(repo => repo.close()); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
function entries(until = '2026/09'): unknown[] {
  const out = [];
  for (let round = ym('2026/01'); compareYearMonth(round, ym(until)) <= 0; round = addMonths(round, 1)) {
    const actuals = [];
    for (let month = ym('2026/01'); compareYearMonth(month, round) < 0; month = addMonths(month, 1)) actuals.push({ month, value: 110 });
    out.push({ round, sheetStart: '2026/01', actuals, plans: [0, 1, 2, 3].map(i => ({ month: addMonths(round, i), value: 100 })) });
  }
  return out;
}
function economic(value = 100): SourceResult {
  const map = new Map<YearMonth, number>();
  for (let month = ym('2025/01'); compareYearMonth(month, ym('2026/10')) <= 0; month = addMonths(month, 1)) map.set(month, value);
  return Object.fromEntries(SCORING_RULES.filter(rule => rule.key !== '분양회수예측오차').map(rule => [rule.key, { values: map, unit: '합성 단위', fetchedAt: fixed }])) as unknown as SourceResult;
}
function changedEconomic(source: SourceResult, key: keyof SourceResult, month: YearMonth, value: number | null): SourceResult {
  const item = source[key];
  if (!('values' in item)) throw Error('synthetic series expected');
  const values = new Map(item.values);
  if (value === null) values.delete(month);
  else values.set(month, value);
  return { ...source, [key]: { ...item, values } };
}
function yields(): BondYieldSource {
  return { dailyYields: async month => ({ days: [{ date: parseCalendarDate(`${month}/28`), publicAaa: { average: 3.674, byAgency: { 나이스피앤아이: null, 한국자산평가: null, KIS자산평가: null } }, treasury: { average: 3.393, byAgency: { 나이스피앤아이: null, 한국자산평가: null, KIS자산평가: null } } }], fetchedAt: fixed }) };
}
function deps(repository: SqliteHistoryRepository, indicators: EconomicIndicatorSource, bond: BondYieldSource, metadataClock: () => Date, clock = () => fixed): HistoryDependencies {
  return { repository, indicators, yields: bond, clock, metadataClock, hash: hashHistoryValue, encode: evidenceToJson, decode: evidenceFromJson,
    calculationVersion: HISTORY_CALCULATION_VERSION, captureIndicators: captureEconomicSource, captureYields: captureBondSource,
    replayIndicators: replayEconomicSource, replayYields: replayBondSource, isUnsafe: () => false };
}
const key = '11111111-1111-4111-8111-111111111111';
describe('historical backfill SQLite boundary', () => {
  it('matches both old monthly outcomes exactly, keeps one frozen ECOS and one KOFIA call per observed month across resume', async () => {
    const repo = open();
    const scopeId = await repo.defaultScopeId();
    const rounds = entries(), ledger = ledgerOf(rounds);
    const ecos = economic(); let currentEcos = ecos; let ecosCalls = 0; const months: YearMonth[] = [];
    const source: EconomicIndicatorSource = { fetchAll: async () => { ecosCalls++; return currentEcos; } };
    const bond: BondYieldSource = { dailyYields: async month => { months.push(month); return yields().dailyYields(month); } };
    let now = fixed;
    const d = deps(repo, source, bond, () => now);
    const input = { scopeId, startKey: key, fromCycle: ym('2026/08'), toCycle: ym('2026/09'), rounds };
    const started = await startBackfill(d, input);
    currentEcos = economic(999);
    now = new Date(fixed.getTime() + 1000);
    expect((await startBackfill(d, input)).batchId).toBe(started.batchId);
    expect((await repo.getBatch(scopeId, started.batchId))?.fixedNow).toBe(fixed.toISOString());
    expect(ecosCalls).toBe(1);
    const first = await runBackfillStep(d, scopeId, started.batchId);
    expect(first.completedCycles).toEqual([ym('2026/08')]);
    const secondRepo = open(repo.databasePath);
    const resumed = await runBackfillStep(deps(secondRepo, source, bond, () => now), scopeId, started.batchId);
    expect(resumed.status).toBe('completed');
    expect((await runBackfillStep(d, scopeId, started.batchId)).status).toBe('completed');
    expect(ecosCalls).toBe(1);
    expect(months).toEqual([ym('2026/07'), ym('2026/08')]);
    const selection = await repo.createHistorySelection({ scopeId, basis: { reportCycle: ym('2026/09'), reportTitleMonth: ym('2026/08'), constructionBaseMonth: ym('2026/07'), fundingJudgedMonth: ym('2026/09'), fundingObservedMonth: ym('2026/08'), gapMonth: ym('2026/09') }, calculationVersion: HISTORY_CALCULATION_VERSION, asOf: new Date(now.getTime() + 1000).toISOString(), selectedBackfillBatchId: started.batchId });
    expect(selection.calculations).toHaveLength(4);
    for (const cycle of [ym('2026/08'), ym('2026/09')]) {
      const construction = selection.calculations.find(c => c.indicator === 'construction' && c.effectiveMonth === addMonths(cycle, -2));
      const funding = selection.calculations.find(c => c.indicator === 'funding' && c.effectiveMonth === addMonths(cycle, -1));
      expect(construction?.origin).toBe('reconstructed');
      expect(evidenceFromJson(construction!.resultJson)).toEqual(await assessPerception({ fetchAll: async () => ecos }, ledger, { reportMonth: cycle }, () => fixed));
      expect(evidenceFromJson(funding!.resultJson)).toEqual(await assessFundingRiskReport(yields(), { judgedMonth: cycle }, () => fixed));
    }
    const refreshed = await startBackfill(d, { ...input, startKey: '33333333-3333-4333-8333-333333333333' });
    expect(refreshed.batchId).not.toBe(started.batchId);
    expect(ecosCalls).toBe(2);
    const refreshedSlot = await repo.claimCaptureSlot({ scopeId, batchId: refreshed.batchId, sourceKey: 'ecos', ownerId: 'inspection', now: now.toISOString(), leaseUntil: new Date(now.getTime() + 90000).toISOString() });
    if (refreshedSlot.kind !== 'ready') throw Error('captured slot expected');
    const refreshedEvidence = await repo.getEvidence(scopeId, refreshedSlot.captureId);
    const observation = evidenceFromJson<{ kind: 'returned'; value: SourceResult }>(refreshedEvidence!.payloadJson);
    expect('values' in observation.value.총수주액 && observation.value.총수주액.values.get(ym('2026/06'))).toBe(999);
  });

  it('returns transient busy, recovers an expired lease, and never saves an unfenced response', async () => {
    const repo = open(), scopeId = await repo.defaultScopeId();
    let now = fixed; let calls = 0;
    const source = { fetchAll: async () => { calls++; return economic(); } };
    const rounds = entries();
    const { batchId } = await repo.putBatch({ scopeId, startKey: key, fromCycle: ym('2026/08'), toCycle: ym('2026/08'), inputHash: hashHistoryValue(rounds), roundEntriesJson: evidenceToJson(rounds), fixedNow: fixed.toISOString(), evaluationTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, evaluatedCalendar: { year: fixed.getFullYear(), month: fixed.getMonth() + 1, day: fixed.getDate() } });
    const secondRepo = open(repo.databasePath);
    const d = deps(secondRepo, source, yields(), () => now);
    const claim = await repo.claimCaptureSlot({ scopeId, batchId, sourceKey: 'ecos', ownerId: 'old', now: now.toISOString(), leaseUntil: new Date(now.getTime() + 90000).toISOString() });
    expect((await secondRepo.claimCaptureSlot({ scopeId, batchId, sourceKey: 'ecos', ownerId: 'other', now: now.toISOString(), leaseUntil: new Date(now.getTime() + 90000).toISOString() })).kind).toBe('busy');
    await expect(runBackfillStep(d, scopeId, batchId)).rejects.toMatchObject({ reason: 'CAPTURE_BUSY' } satisfies Partial<BackfillRetryError>);
    expect(calls).toBe(0);
    now = new Date(now.getTime() + 90001);
    const progressed = await runBackfillStep(d, scopeId, batchId);
    expect(progressed.status).toBe('completed');
    expect(calls).toBe(1);
    if (claim.kind !== 'claimed') throw Error('claim expected');
    const late = await repo.completeCaptureSlot({ scopeId, batchId, sourceKey: 'ecos', ownerId: 'old', fence: claim.fence,
      evidence: { scopeId, sourceKind: 'ecos', contentHash: 'late', payloadJson: evidenceToJson({ kind: 'returned', value: economic(999) }), schemaVersion: 1, receivedAt: now.toISOString(), derivation: { kind: 'captured' } } });
    expect(late).toEqual({ kind: 'stale' });
  });
  it('rolls back evidence when linking the capture slot fails in the same transaction', async () => {
    const repo = open(), scopeId = await repo.defaultScopeId();
    const { batchId } = await repo.putBatch({ scopeId, startKey: key, fromCycle: ym('2026/08'), toCycle: ym('2026/08'), inputHash: 'synthetic', roundEntriesJson: evidenceToJson(entries()), fixedNow: fixed.toISOString(), evaluationTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, evaluatedCalendar: { year: fixed.getFullYear(), month: fixed.getMonth() + 1, day: fixed.getDate() } });
    const claimInput = { scopeId, batchId, sourceKey: 'ecos', ownerId: 'owner', now: fixed.toISOString(), leaseUntil: new Date(fixed.getTime() + 90000).toISOString() };
    const claim = await repo.claimCaptureSlot(claimInput);
    if (claim.kind !== 'claimed') throw Error('claim expected');
    const secondRepo = open(repo.databasePath);
    const db = new DatabaseSync(repo.databasePath);
    try {
      db.exec("CREATE TRIGGER fail_slot_link BEFORE UPDATE OF capture_id ON batch_capture_slot BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_SLOT_LINK_FAILURE'); END");
      await expect(secondRepo.completeCaptureSlot({ ...claimInput, fence: claim.fence, evidence: { scopeId, sourceKind: 'ecos', contentHash: 'synthetic-rollback', payloadJson: evidenceToJson({ kind: 'returned', value: economic() }), schemaVersion: 1, receivedAt: fixed.toISOString(), derivation: { kind: 'captured' } } })).rejects.toThrow('SYNTHETIC_SLOT_LINK_FAILURE');
      expect((db.prepare("SELECT COUNT(*) AS count FROM source_capture WHERE content_hash='synthetic-rollback'").get() as { count: number }).count).toBe(0);
      expect((db.prepare('SELECT capture_id, fence FROM batch_capture_slot WHERE batch_id=? AND source_key=?').get(batchId, 'ecos') as { capture_id: string | null; fence: number })).toEqual({ capture_id: null, fence: claim.fence });
    } finally { db.close(); }
  });
  it('rejects changed evaluation zones before requesting any source', async () => {
    const repo = open(), scopeId = await repo.defaultScopeId();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone === 'UTC' ? 'Asia/Seoul' : 'UTC';
    const { batchId } = await repo.putBatch({ scopeId, startKey: key, fromCycle: ym('2026/08'), toCycle: ym('2026/08'), inputHash: 'synthetic', roundEntriesJson: evidenceToJson(entries()), fixedNow: fixed.toISOString(), evaluationTimeZone: zone, evaluatedCalendar: { year: 2026, month: 10, day: 23 } });
    let calls = 0;
    const d = deps(repo, { fetchAll: async () => { calls++; return economic(); } }, yields(), () => fixed);
    await expect(runBackfillStep(d, scopeId, batchId)).rejects.toThrow('EVALUATION_ZONE_MISMATCH');
    expect(calls).toBe(0);
    expect((await repo.getBatch(scopeId, batchId))?.pendingCycles).toEqual([ym('2026/08')]);
  });
  it('rejects same-key start recovery in a different zone before an uncaptured ECOS call', async () => {
    const repo = open(), scopeId = await repo.defaultScopeId();
    const rounds = entries(), ledger = ledgerOf(rounds), normalized = ledger.rounds().map(round => ledger.entryOf(round));
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone === 'UTC' ? 'Asia/Seoul' : 'UTC';
    const { batchId } = await repo.putBatch({ scopeId, startKey: key, fromCycle: ym('2026/08'), toCycle: ym('2026/08'), inputHash: hashHistoryValue(normalized), roundEntriesJson: evidenceToJson(normalized), fixedNow: fixed.toISOString(), evaluationTimeZone: zone, evaluatedCalendar: { year: 2026, month: 10, day: 23 } });
    let calls = 0;
    const d = deps(repo, { fetchAll: async () => { calls++; return economic(); } }, yields(), () => fixed);
    await expect(startBackfill(d, { scopeId, startKey: key, fromCycle: ym('2026/08'), toCycle: ym('2026/08'), rounds })).rejects.toThrow('EVALUATION_ZONE_MISMATCH');
    expect(calls).toBe(0);
    expect((await repo.getBatch(scopeId, batchId))?.pendingCycles).toEqual([ym('2026/08')]);
  });
  it('retries an upstream call after a pre-save crash and records the later receipt time', async () => {
    const repo = open(), scopeId = await repo.defaultScopeId();
    let now = fixed, calls = 0;
    const source = { fetchAll: async () => { calls++; return economic(); } };
    const failing = new Proxy(repo, { get(target, property) {
      if (property === 'completeCaptureSlot') return async () => { throw Error('SYNTHETIC_DISK_FAILURE'); };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const input = { scopeId, startKey: key, fromCycle: ym('2026/08'), toCycle: ym('2026/08'), rounds: entries() };
    await expect(startBackfill(deps(failing, source, yields(), () => now), input)).rejects.toThrow('SYNTHETIC_DISK_FAILURE');
    expect(calls).toBe(1);
    await expect(startBackfill(deps(repo, source, yields(), () => now), input)).rejects.toMatchObject({ reason: 'CAPTURE_BUSY' });
    now = new Date(now.getTime() + 90001);
    const batch = await startBackfill(deps(repo, source, yields(), () => now), input);
    expect(calls).toBe(2);
    expect(batch.fixedNow).toBe(fixed.toISOString());
    const slot = await repo.claimCaptureSlot({ scopeId, batchId: batch.batchId, sourceKey: 'ecos', ownerId: 'inspection', now: now.toISOString(), leaseUntil: new Date(now.getTime() + 90000).toISOString() });
    if (slot.kind !== 'ready') throw Error('captured slot expected');
    expect((await repo.getEvidence(scopeId, slot.captureId))?.receivedAt).toBe(now.toISOString());
  });
  it('persists a future observed-month absence without ever claiming KOFIA', async () => {
    const repo = open(), scopeId = await repo.defaultScopeId();
    let calls = 0;
    const d = deps(repo, { fetchAll: async () => economic() }, { dailyYields: async () => { calls++; return { days: [], fetchedAt: fixed }; } }, () => fixed);
    const batch = await startBackfill(d, { scopeId, startKey: key, fromCycle: ym('2026/11'), toCycle: ym('2026/11'), rounds: entries('2026/11') });
    expect((await runBackfillStep(d, scopeId, batch.batchId)).status).toBe('completed');
    expect(calls).toBe(0);
    const records = await repo.listCalculations({ scopeId, indicator: 'funding', from: ym('2026/10'), to: ym('2026/10'), calculationVersion: HISTORY_CALCULATION_VERSION, asOf: new Date(fixed.getTime() + 1000).toISOString(), selectedBackfillBatchId: batch.batchId });
    expect(records).toHaveLength(1);
    expect(records[0].captureIds).toEqual([]);
    expect(evidenceFromJson<{ ok: boolean; value: { result: { reason: string } } }>(records[0].resultJson).value.result.reason).toContain('말이 지나지 않았습니다');
  });
  it('adopts one step and one pair of calculation IDs when two repository connections race', async () => {
    const firstRepo = open(), scopeId = await firstRepo.defaultScopeId();
    const firstDeps = deps(firstRepo, { fetchAll: async () => economic() }, yields(), () => fixed);
    const batch = await startBackfill(firstDeps, { scopeId, startKey: key, fromCycle: ym('2026/08'), toCycle: ym('2026/08'), rounds: entries() });
    const slotInput = { scopeId, batchId: batch.batchId, sourceKey: 'kofia:2026/07', ownerId: 'prefill', now: fixed.toISOString(), leaseUntil: new Date(fixed.getTime() + 90000).toISOString() };
    const claim = await firstRepo.claimCaptureSlot(slotInput);
    if (claim.kind !== 'claimed') throw Error('claim expected');
    await firstRepo.completeCaptureSlot({ ...slotInput, fence: claim.fence, evidence: { scopeId, sourceKind: 'kofia', contentHash: 'prefill', payloadJson: evidenceToJson({ kind: 'returned', value: await yields().dailyYields(ym('2026/07')) }), schemaVersion: 1, receivedAt: fixed.toISOString(), derivation: { kind: 'captured' } } });
    const secondRepo = open(firstRepo.databasePath);
    const secondDeps = deps(secondRepo, { fetchAll: async () => { throw Error('ECOS_REFETCH'); } }, { dailyYields: async () => { throw Error('KOFIA_REFETCH'); } }, () => fixed);
    const [one, two] = await Promise.all([runBackfillStep(firstDeps, scopeId, batch.batchId), runBackfillStep(secondDeps, scopeId, batch.batchId)]);
    expect(one).toEqual(two);
    expect(one.status).toBe('completed');
    const db = new DatabaseSync(firstRepo.databasePath, { readOnly: true });
    try { expect((db.prepare('SELECT COUNT(*) AS count FROM backfill_step WHERE batch_id=?').get(batch.batchId) as { count: number }).count).toBe(1); }
    finally { db.close(); }
    const selection = await firstRepo.createHistorySelection({ scopeId, basis: { reportCycle: ym('2026/08'), reportTitleMonth: ym('2026/07'), constructionBaseMonth: ym('2026/06'), fundingJudgedMonth: ym('2026/08'), fundingObservedMonth: ym('2026/07'), gapMonth: ym('2026/08') }, calculationVersion: HISTORY_CALCULATION_VERSION, asOf: new Date(fixed.getTime() + 1000).toISOString(), selectedBackfillBatchId: batch.batchId });
    expect(selection.historyCalculationIds).toHaveLength(2);
    const visible = await firstRepo.listCalculations({ scopeId, indicator: 'construction', from: ym('2026/06'), to: ym('2026/06'), calculationVersion: HISTORY_CALCULATION_VERSION, asOf: new Date(fixed.getTime() + 1000).toISOString(), selectedBackfillBatchId: batch.batchId });
    expect(visible.map(record => record.calculationId)).toEqual([selection.calculations.find(record => record.indicator === 'construction')!.calculationId]);
  });
  it('records actual upstream failures as frozen unavailable outcomes and does not refetch them', async () => {
    const repo = open(), scopeId = await repo.defaultScopeId();
    let ecosCalls = 0, kofiaCalls = 0;
    const d = deps(repo, { fetchAll: async () => { ecosCalls++; throw Error('synthetic ECOS outage'); } },
      { dailyYields: async () => { kofiaCalls++; return { error: 'synthetic KOFIA outage' }; } }, () => fixed);
    const batch = await startBackfill(d, { scopeId, startKey: key, fromCycle: ym('2026/08'), toCycle: ym('2026/08'), rounds: entries() });
    expect((await runBackfillStep(d, scopeId, batch.batchId)).status).toBe('completed');
    expect((await runBackfillStep(d, scopeId, batch.batchId)).status).toBe('completed');
    expect(ecosCalls).toBe(1);
    expect(kofiaCalls).toBe(1);
    const construction = await repo.listCalculations({ scopeId, indicator: 'construction', from: ym('2026/06'), to: ym('2026/06'), calculationVersion: HISTORY_CALCULATION_VERSION, asOf: new Date(fixed.getTime() + 1000).toISOString(), selectedBackfillBatchId: batch.batchId });
    const funding = await repo.listCalculations({ scopeId, indicator: 'funding', from: ym('2026/07'), to: ym('2026/07'), calculationVersion: HISTORY_CALCULATION_VERSION, asOf: new Date(fixed.getTime() + 1000).toISOString(), selectedBackfillBatchId: batch.batchId });
    expect(evidenceFromJson<{ value: { result: { kind: string; missing: { reason: string }[] } } }>(construction[0].resultJson).value.result.missing[0].reason).toContain('ECOS 조회 실패');
    expect(evidenceFromJson<{ value: { result: { reason: string } } }>(funding[0].resultJson).value.result.reason).toContain('synthetic KOFIA outage');
  });
  it.each([
    { name: 'ECOS previous-month raw absence', econ: () => changedEconomic(economic(), '주택매매가격지수', ym('2026/05'), null), bond: yields, indicator: 'construction', reason: '2026/05(전월) 값이 없습니다' },
    { name: 'ECOS prior-year raw absence', econ: () => changedEconomic(economic(), '총수주액', ym('2025/06'), null), bond: yields, indicator: 'construction', reason: '2025/06(전년동월) 값이 없습니다' },
    { name: 'ECOS zero comparison', econ: () => changedEconomic(economic(), '총수주액', ym('2025/06'), 0), bond: yields, indicator: 'construction', reason: '값이 0이라 변화율을 낼 수 없습니다' },
    { name: 'KOFIA latest evaluation average absent', econ: economic, bond: (): BondYieldSource => ({ dailyYields: async () => ({ days: [
      { date: parseCalendarDate('2026/07/30'), publicAaa: { average: 3.674, byAgency: { 나이스피앤아이: null, 한국자산평가: null, KIS자산평가: null } }, treasury: { average: 3.393, byAgency: { 나이스피앤아이: null, 한국자산평가: null, KIS자산평가: null } } },
      { date: parseCalendarDate('2026/07/31'), publicAaa: { average: null, byAgency: { 나이스피앤아이: null, 한국자산평가: null, KIS자산평가: null } }, treasury: { average: 3.393, byAgency: { 나이스피앤아이: null, 한국자산평가: null, KIS자산평가: null } } },
    ], fetchedAt: fixed }) }), indicator: 'funding', reason: '2026/07/31 평가일의 공사채 AAA 3사 평균이 비어 있습니다' },
  ])('$name persists the full existing monthly outcomes', async scenario => {
    const repo = open(), scopeId = await repo.defaultScopeId(), rounds = entries(), ledger = ledgerOf(rounds);
    const econ = scenario.econ(), bond = scenario.bond(), cycle = ym('2026/08');
    const d = deps(repo, { fetchAll: async () => econ }, bond, () => fixed);
    const batch = await startBackfill(d, { scopeId, startKey: key, fromCycle: cycle, toCycle: cycle, rounds });
    expect((await runBackfillStep(d, scopeId, batch.batchId)).status).toBe('completed');
    const construction = await repo.listCalculations({ scopeId, indicator: 'construction', from: ym('2026/06'), to: ym('2026/06'), calculationVersion: HISTORY_CALCULATION_VERSION, asOf: new Date(fixed.getTime() + 1000).toISOString(), selectedBackfillBatchId: batch.batchId });
    const funding = await repo.listCalculations({ scopeId, indicator: 'funding', from: ym('2026/07'), to: ym('2026/07'), calculationVersion: HISTORY_CALCULATION_VERSION, asOf: new Date(fixed.getTime() + 1000).toISOString(), selectedBackfillBatchId: batch.batchId });
    const storedConstruction = evidenceFromJson(construction[0].resultJson);
    const storedFunding = evidenceFromJson(funding[0].resultJson);
    expect(storedConstruction).toEqual(await assessPerception({ fetchAll: async () => econ }, ledger, { reportMonth: cycle }, () => fixed));
    expect(storedFunding).toEqual(await assessFundingRiskReport(bond, { judgedMonth: cycle }, () => fixed));
    if (scenario.indicator === 'construction') expect(JSON.stringify(storedConstruction)).toContain(scenario.reason);
    else expect(JSON.stringify(storedFunding)).toContain(scenario.reason);
  });
});
