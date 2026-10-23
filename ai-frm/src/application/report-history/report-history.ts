import { assessPerception, type PerceptionReport, type PerceptionRequest } from '../construction-perception';
import { assessFundingRiskReport, type FundingRiskReport, type FundingRiskRequest } from '../funding-risk';
import type { Outcome } from '../outcome';
import type { ForecastLedger } from '../../domain/cashflow/forecast-ledger';
import { baseMonthOfRound, baseMonthOfToday } from '../../domain/risk/construction-perception/construction-perception';
import { observedMonthOf } from '../../domain/risk/funding-risk/funding-risk';
import { yearMonthOfDate } from '../../domain/shared/year-month';
import type { CapturedOutcome } from '../../domain/report-history/report-history';
import type { HistoryDependencies, CalculationWrite, SourceObservation } from './ports';

function clockTrace(clock: () => Date) {
  const calls: Date[] = [];
  return { clock: () => { const value = clock(); calls.push(new Date(value.getTime())); return value; }, calls };
}
function calendar(date: Date) {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}
function definedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}
function failure<T>(outcome: T): CapturedOutcome<T> {
  return { outcome, history: { captureStatus: 'failed', code: 'STORAGE_UNAVAILABLE' } };
}
async function save<T>(
  deps: HistoryDependencies,
  scopeId: string,
  outcome: T,
  indicator: CalculationWrite['indicator'],
  effectiveMonth: CalculationWrite['effectiveMonth'],
  requestContext: unknown,
  input: unknown,
  observed: SourceObservation<unknown>,
  calls: readonly Date[],
): Promise<CapturedOutcome<T>> {
  try {
    if (!calls.length || deps.isUnsafe({ outcome, observed, requestContext, input })) return failure(outcome);
    const capturedAt = deps.metadataClock().toISOString();
    const captureIds: string[] = [];
    if (observed.kind !== 'not-requested') {
      const capture = await deps.repository.putEvidence({
        scopeId, sourceKind: indicator === 'construction' ? 'ecos' : 'kofia',
        contentHash: deps.hash(observed), payloadJson: deps.encode(observed), schemaVersion: 1,
        receivedAt: capturedAt, derivation: { kind: 'captured' },
      });
      captureIds.push(capture.captureId);
    }
    const first = calls[0];
    const contextHash = deps.hash({ requestContext, input });
    const record = await deps.repository.putCalculation({
      scopeId, indicator, origin: 'live', derivation: { kind: 'captured' }, effectiveMonth,
      requestContext: deps.encode({ request: requestContext, input, sourceState: observed.kind }),
      inputHash: deps.hash(input), calculationVersion: deps.calculationVersion, captureIds,
      resultJson: deps.encode(outcome), evaluatedAt: first.toISOString(),
      evaluationClockTrace: calls.map(call => call.toISOString()), evaluatedCalendar: calendar(first),
      evaluationTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      createdAt: capturedAt,
    });
    return { outcome, history: { captureStatus: 'saved', calculationId: record.calculationId, contextHash } };
  } catch {
    return failure(outcome);
  }
}

export async function captureConstruction(
  deps: HistoryDependencies, scopeId: string, request: PerceptionRequest, ledger: ForecastLedger,
): Promise<CapturedOutcome<Outcome<PerceptionReport>>> {
  const trace = clockTrace(deps.clock), source = deps.captureIndicators(deps.indicators);
  const outcome = await assessPerception(source.source, ledger, request, trace.clock);
  try {
    const first = trace.calls[0];
    const effectiveMonth = outcome.ok ? outcome.value.result.month : request.baseMonth ?? (request.reportMonth ? baseMonthOfRound(request.reportMonth) : baseMonthOfToday(yearMonthOfDate(first)));
    const entries = ledger.rounds().map(round => ledger.entryOf(round));
    return await save(deps, scopeId, outcome, 'construction', effectiveMonth, definedFields(request), entries, source.observation(), trace.calls);
  } catch {
    return failure(outcome);
  }
}

export async function captureFunding(
  deps: HistoryDependencies, scopeId: string, request: FundingRiskRequest,
): Promise<CapturedOutcome<Outcome<FundingRiskReport>>> {
  const trace = clockTrace(deps.clock), source = deps.captureYields(deps.yields);
  const outcome = await assessFundingRiskReport(source.source, request, trace.clock);
  try {
    const judgedMonth = request.judgedMonth ?? yearMonthOfDate(trace.calls[0]);
    const effectiveMonth = outcome.ok ? outcome.value.result.observedMonth : observedMonthOf(judgedMonth);
    return await save(deps, scopeId, outcome, 'funding', effectiveMonth, definedFields(request), { judgedMonth }, source.observation(), trace.calls);
  } catch {
    return failure(outcome);
  }
}
