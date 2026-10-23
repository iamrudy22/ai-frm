import { assessPerception } from '../construction-perception';
import { assessFundingRiskReport } from '../funding-risk';
import { ledgerOf } from '../../domain/cashflow/forecast-ledger';
import { forecastErrorForBaseMonth, roundsNeededFor } from '../../domain/risk/construction-perception/forecast-error';
import { addMonths, compareYearMonth, parseYearMonth, yearMonthOfDate, type YearMonth } from '../../domain/shared/year-month';
import type { SourceResult, YieldFetch } from '../ports';
import type { BatchWrite, CalculationWrite, HistoryDependencies, SourceObservation, StoredBatch } from './ports';

export type BackfillInput = { readonly fromCycle: YearMonth; readonly toCycle: YearMonth; readonly rounds: readonly unknown[] };
export type BackfillPlan = { readonly cycles: readonly YearMonth[]; readonly anchorCycle: YearMonth; readonly readiness: readonly { readonly reportCycle: YearMonth; readonly constructionBaseMonth: YearMonth; readonly missingRounds: readonly YearMonth[]; readonly localReason: string | null }[] };
export class BackfillRetryError extends Error {
  constructor(readonly reason: 'CAPTURE_BUSY' | 'CAPTURE_FENCED') { super(reason); }
}
function assertEvaluationContext(batch: StoredBatch): void {
  const fixed = new Date(batch.fixedNow);
  if (batch.evaluationTimeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone ||
      batch.evaluatedCalendar.year !== fixed.getFullYear() || batch.evaluatedCalendar.month !== fixed.getMonth() + 1 || batch.evaluatedCalendar.day !== fixed.getDate())
    throw Error('EVALUATION_ZONE_MISMATCH');
}
function requireReplay(deps: HistoryDependencies): asserts deps is HistoryDependencies & Required<Pick<HistoryDependencies, 'decode' | 'replayIndicators' | 'replayYields'>> {
  if (!deps.decode || !deps.replayIndicators || !deps.replayYields) throw Error('BACKFILL_REPLAY_NOT_CONFIGURED');
}

export function planBackfill(input: BackfillInput): BackfillPlan {
  parseYearMonth(input.fromCycle); parseYearMonth(input.toCycle);
  const ledger = ledgerOf(input.rounds);
  const anchorCycle = ledger.latestRound();
  if (!anchorCycle) throw Error('NO_REPORT_CYCLE');
  if (compareYearMonth(input.fromCycle, input.toCycle) > 0 || compareYearMonth(input.toCycle, anchorCycle) > 0) throw Error('INVALID_BACKFILL_RANGE');
  const cycles: YearMonth[] = [];
  for (let cycle = input.fromCycle; compareYearMonth(cycle, input.toCycle) <= 0; cycle = addMonths(cycle, 1)) {
    cycles.push(cycle);
    if (cycles.length > 18) throw Error('LIMIT_EXCEEDED');
  }
  return { cycles, anchorCycle, readiness: cycles.map(reportCycle => {
    const constructionBaseMonth = addMonths(reportCycle, -2);
    const needed = roundsNeededFor(constructionBaseMonth);
    const missingRounds = [needed.plan, needed.actual].filter(round => ledger.entryOf(round) === undefined);
    const error = forecastErrorForBaseMonth(ledger, constructionBaseMonth);
    return { reportCycle, constructionBaseMonth, missingRounds, localReason: typeof error === 'number' ? null : error.missing };
  }) };
}

type SlotKind = 'ecos' | `kofia:${YearMonth}`;
async function captured<T>(deps: HistoryDependencies, scopeId: string, batchId: string, sourceKey: SlotKind, sourceKind: 'ecos' | 'kofia', fetch: () => Promise<T>): Promise<{ observation: SourceObservation<T>; captureId: string }> {
  const now = deps.metadataClock();
  const ownerId = globalThis.crypto.randomUUID();
  const claim = await deps.repository.claimCaptureSlot({ scopeId, batchId, sourceKey, ownerId, now: now.toISOString(), leaseUntil: new Date(now.getTime() + 90000).toISOString() });
  if (claim.kind === 'busy') throw new BackfillRetryError('CAPTURE_BUSY');
  if (claim.kind === 'ready') {
    const evidence = await deps.repository.getEvidence(scopeId, claim.captureId);
    if (!evidence) throw Error('CAPTURE_EVIDENCE_MISSING');
    requireReplay(deps);
    return { observation: deps.decode<SourceObservation<T>>(evidence.payloadJson), captureId: evidence.captureId };
  }
  let observation: SourceObservation<T>;
  try { observation = { kind: 'returned', value: await fetch() }; }
  catch (error) { observation = error instanceof Error ? { kind: 'threw', errorKind: 'error', message: error.message } : { kind: 'threw', errorKind: 'non-error' }; }
  if (deps.isUnsafe(observation)) throw Error('UNSAFE_SOURCE_EVIDENCE');
  const receivedAt = deps.metadataClock().toISOString();
  const result = await deps.repository.completeCaptureSlot({
    scopeId, batchId, sourceKey, ownerId, fence: claim.fence,
    evidence: { scopeId, sourceKind, contentHash: deps.hash(observation), payloadJson: deps.encode(observation), schemaVersion: 1, receivedAt, derivation: { kind: 'captured' } },
  });
  if (result.kind === 'stale') throw new BackfillRetryError('CAPTURE_FENCED');
  return { observation, captureId: result.captureId };
}

export async function startBackfill(deps: HistoryDependencies, input: BackfillInput & { readonly scopeId: string; readonly startKey: string }): Promise<StoredBatch> {
  planBackfill(input);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.startKey)) throw Error('INVALID_START_KEY');
  const ledger = ledgerOf(input.rounds);
  const entries = ledger.rounds().map(round => ledger.entryOf(round));
  const fixedNow = deps.clock().toISOString();
  const fixedDate = new Date(fixedNow);
  const write: BatchWrite = { scopeId: input.scopeId, startKey: input.startKey, fromCycle: input.fromCycle, toCycle: input.toCycle, inputHash: deps.hash(entries), roundEntriesJson: deps.encode(entries), fixedNow,
    evaluationTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    evaluatedCalendar: { year: fixedDate.getFullYear(), month: fixedDate.getMonth() + 1, day: fixedDate.getDate() } };
  const { batchId } = await deps.repository.putBatch(write);
  const batch = await deps.repository.getBatch(input.scopeId, batchId);
  if (!batch) throw Error('BATCH_NOT_FOUND');
  assertEvaluationContext(batch);
  await captured(deps, input.scopeId, batchId, 'ecos', 'ecos', () => deps.indicators.fetchAll());
  return batch;
}

function calculationWrite(deps: HistoryDependencies, batch: StoredBatch, indicator: 'construction' | 'funding', reportCycle: YearMonth, result: unknown, captureIds: readonly string[], calls: readonly Date[], input: unknown, sourceState: SourceObservation<unknown>['kind']): CalculationWrite {
  const effectiveMonth = addMonths(reportCycle, indicator === 'construction' ? -2 : -1);
  return {
    scopeId: batch.scopeId, batchId: batch.batchId, indicator, origin: 'reconstructed', derivation: { kind: 'captured' }, effectiveMonth,
    requestContext: deps.encode(indicator === 'construction' ? { request: { reportMonth: reportCycle }, input, sourceState } : { request: { judgedMonth: reportCycle }, input, sourceState }),
    inputHash: deps.hash(input), calculationVersion: deps.calculationVersion, captureIds, resultJson: deps.encode(result),
    evaluatedAt: batch.fixedNow, evaluationClockTrace: calls.map(call => call.toISOString()),
    evaluatedCalendar: batch.evaluatedCalendar,
    evaluationTimeZone: batch.evaluationTimeZone, createdAt: deps.metadataClock().toISOString(),
  };
}

export async function runBackfillStep(deps: HistoryDependencies, scopeId: string, batchId: string): Promise<StoredBatch> {
  requireReplay(deps);
  const batch = await deps.repository.getBatch(scopeId, batchId);
  if (!batch) throw Error('BATCH_NOT_FOUND');
  assertEvaluationContext(batch);
  const reportCycle = batch.pendingCycles[0];
  if (!reportCycle) return batch;
  const ecos = await captured<SourceResult>(deps, scopeId, batchId, 'ecos', 'ecos', () => deps.indicators.fetchAll());
  const observedMonth = addMonths(reportCycle, -1);
  const needsKofia = compareYearMonth(observedMonth, yearMonthOfDate(new Date(batch.fixedNow))) < 0;
  const kofia = needsKofia ? await captured<YieldFetch>(deps, scopeId, batchId, `kofia:${observedMonth}`, 'kofia', () => deps.yields.dailyYields(observedMonth)) : null;
  const entries = deps.decode<unknown[]>(batch.roundEntriesJson);
  const ledger = ledgerOf(entries);
  const calls: Date[] = [];
  const fixedClock = () => { const value = new Date(batch.fixedNow); calls.push(value); return value; };
  const construction = await assessPerception(deps.replayIndicators(ecos.observation), ledger, { reportMonth: reportCycle }, fixedClock);
  const constructionCalls = [...calls]; calls.length = 0;
  const funding = await assessFundingRiskReport(kofia ? deps.replayYields(kofia.observation) : { dailyYields: async () => { throw Error('UNEXPECTED_KOFIA_REQUEST'); } }, { judgedMonth: reportCycle }, fixedClock);
  const fundingCalls = [...calls];
  const constructionInput = ledger.rounds().map(round => ledger.entryOf(round));
  const constructionRecord = await deps.repository.putCalculation(calculationWrite(deps, batch, 'construction', reportCycle, construction, [ecos.captureId], constructionCalls, constructionInput, ecos.observation.kind));
  const fundingRecord = await deps.repository.putCalculation(calculationWrite(deps, batch, 'funding', reportCycle, funding, kofia ? [kofia.captureId] : [], fundingCalls, { judgedMonth: reportCycle }, kofia?.observation.kind ?? 'not-requested'));
  try {
    return await deps.repository.commitBatchStep({
      scopeId, batchId, reportCycle,
      basis: { reportCycle, reportTitleMonth: addMonths(reportCycle, -1), constructionBaseMonth: addMonths(reportCycle, -2), fundingJudgedMonth: reportCycle, fundingObservedMonth: observedMonth, gapMonth: reportCycle },
      calculationIds: { construction: constructionRecord.calculationId, funding: fundingRecord.calculationId },
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'BATCH_STEP_CONFLICT') throw error;
    const winner = await deps.repository.getBatch(scopeId, batchId);
    if (winner && winner.completedCycles.includes(reportCycle)) return winner;
    throw error;
  }
}
