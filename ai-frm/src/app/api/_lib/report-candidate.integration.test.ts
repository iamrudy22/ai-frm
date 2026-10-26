import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStatement } from '@/domain/cashflow/statement';
import { assessDashboard } from '@/application/dashboard';
import { roundEntryOf } from '@/domain/cashflow/round-entry';
import { amount } from '@/domain/shared/amount';
import { addMonths, yearMonth } from '@/domain/shared/year-month';
import { SqliteHistoryRepository, hashHistoryValue, HISTORY_CALCULATION_VERSION } from '@/infrastructure/report-history/sqlite-history-repository';
import { evidenceToJson, evidenceFromJson } from '@/infrastructure/report-history/evidence-codec';
import type { HistoryDependencies, CalculationWrite } from '@/application/report-history/ports';
import { prepareReportCandidate, confirmMonthlyReport, openConfirmedReport, snapshotStatement } from '@/application/report-history/report-candidate';
import { handleConfirmationGet, handleConfirmationPost, reportDocumentFactory } from './report-history-confirmation-handlers';
import { arrangeRounds } from '@/app/aifrm/uploaded-rounds';
import { buildFinancialReport } from '@/app/aifrm/report-model';
import { withExternalRiskHistory } from '@/app/aifrm/report-history-projection';
import { selectionView } from './report-history-selection-handlers';

const dirs: string[] = [];
const repos: SqliteHistoryRepository[] = [];
afterEach(() => { repos.splice(0).forEach(repo => repo.close()); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });

const cycle = yearMonth(2026, 8);
const basis = { reportCycle: cycle, reportTitleMonth: yearMonth(2026, 7), constructionBaseMonth: yearMonth(2026, 6),
  fundingJudgedMonth: cycle, fundingObservedMonth: yearMonth(2026, 7), gapMonth: cycle };
const now = '2026-10-25T03:00:00.000Z';
function statement(value = 7) {
  const values = (n: number) => [n, n, n, n, n].map(amount);
  return createStatement({ asOf: new Date(2026, 7, 1), monthLabels: ['7월','8월','9월','10월','11월'], baseMonthIndex: 1, planYearEndIndex: 4,
    amounts: { 기초시재: values(100), 수입계: values(10), 수입: values(10), 분양회수: values(value), 기타수입: values(3), 지출: values(10) } });
}
async function fixture(rounds = [statement()]) {
  const dir = mkdtempSync(join(tmpdir(), 'aifrm-candidate-')); dirs.push(dir);
  const repository = new SqliteHistoryRepository(join(dir, 'data', 'history.sqlite'), { now: () => now }); repos.push(repository);
  const scopeId = await repository.defaultScopeId();
  const deps = { repository, hash: hashHistoryValue, encode: evidenceToJson, decode: evidenceFromJson,
    metadataClock: () => new Date(now), calculationVersion: HISTORY_CALCULATION_VERSION, isUnsafe: () => false } as unknown as HistoryDependencies;
  const entries = rounds.map(roundEntryOf);
  const evaluatedAt = '2026-10-25T03:00:00.000Z';
  const common: Omit<CalculationWrite,'indicator'|'effectiveMonth'|'requestContext'|'inputHash'|'resultJson'> = {
    scopeId, origin: 'live', derivation: { kind: 'captured' }, calculationVersion: HISTORY_CALCULATION_VERSION, captureIds: [],
    evaluatedAt, evaluationClockTrace: [evaluatedAt], evaluatedCalendar: { year: 2026, month: 10, day: 25 }, evaluationTimeZone: 'Asia/Seoul', createdAt: now,
  };
  const construction = await repository.putCalculation({ ...common, indicator: 'construction', effectiveMonth: basis.constructionBaseMonth,
    requestContext: evidenceToJson({ request: { reportMonth: cycle }, input: entries, sourceState: 'not-requested' }), inputHash: hashHistoryValue(entries),
    resultJson: evidenceToJson({ ok: false, reason: '합성 산출 불가' }) });
  const funding = await repository.putCalculation({ ...common, indicator: 'funding', effectiveMonth: basis.fundingObservedMonth,
    requestContext: evidenceToJson({ request: { judgedMonth: cycle }, input: { judgedMonth: cycle }, sourceState: 'not-requested' }),
    inputHash: hashHistoryValue({ judgedMonth: cycle }), resultJson: evidenceToJson({ ok: false, reason: '합성 조회 실패' }) });
  const selection = await repository.createHistorySelection({ scopeId, basis, calculationVersion: HISTORY_CALCULATION_VERSION, asOf: now, selectedBackfillBatchId: null });
  const input = { scopeId, basis, statements: rounds.map(snapshotStatement), sourceMetadata: { files: rounds.map((_, index) => index === 0 ? '합성.xlsx' : `합성-${index}.xlsx`) },
    constructionCalculationId: construction.calculationId, fundingCalculationId: funding.calculationId, historySelectionId: selection.historySelectionId,
    authoredAt: '2026-10-24T14:59:00.000Z', inputGeneration: '1' };
  const factory = (restored: { dashboard: unknown; authoredAt: Date }, selected: { historyCalculationIds: readonly string[] }) => {
    const json = { dashboard: restored.dashboard, authoredAt: restored.authoredAt.toISOString() };
    return { schemaVersion: 1 as const, templateVersion: 'report@e3a8f9e', contentHash: hashHistoryValue(json), json: json as never,
      historyCalculationIds: selected.historyCalculationIds };
  };
  return { repository, scopeId, deps, input, factory };
}

describe('candidate preparation and confirmation', () => {
  it('stores every amount, preserves authoredAt, confirms now, and reopens immutable JSON without sources', async () => {
    const f = await fixture();
    const prepared = await prepareReportCandidate(f.deps, f.input, f.factory);
    const stored = await f.repository.getCandidate(f.scopeId, prepared.candidateId);
    expect(stored?.inputSnapshotId).toBeTruthy();
    expect((await f.repository.getInputSnapshot(f.scopeId, stored!.inputSnapshotId))?.statements).toEqual(f.input.statements);
    expect(stored?.authoredAt).toBe(f.input.authoredAt);
    const confirmed = await confirmMonthlyReport(f.deps, f.scopeId, { candidateId: prepared.candidateId, expectedRevision: 0, idempotencyKey: 'same-click' });
    expect(confirmed).toMatchObject({ kind: 'confirmed', revision: 1 });
    if (confirmed.kind !== 'confirmed') throw Error('expected confirmation');
    expect((await f.repository.getConfirmation(f.scopeId, confirmed.confirmationId))?.confirmedAt).toBe(now);
    expect(await openConfirmedReport(f.repository, f.scopeId, confirmed.confirmationId)).toEqual(prepared.document);
    expect(await confirmMonthlyReport(f.deps, f.scopeId, { candidateId: prepared.candidateId, expectedRevision: 0, idempotencyKey: 'lost-response-retry' }))
      .toMatchObject({ kind: 'already-confirmed', confirmationId: confirmed.confirmationId });
  });
  it('keeps filename outside numerical identity and rejects a changed ledger with an old calculation ID', async () => {
    const f = await fixture();
    const first = await prepareReportCandidate(f.deps, f.input, f.factory);
    const renamed = await prepareReportCandidate(f.deps, { ...f.input, sourceMetadata: { files: ['새 이름.xlsx'] } }, f.factory);
    expect((await f.repository.getCandidate(f.scopeId, first.candidateId))?.inputHash).toBe((await f.repository.getCandidate(f.scopeId, renamed.candidateId))?.inputHash);
    await expect(prepareReportCandidate(f.deps, { ...f.input, statements: [snapshotStatement(statement(8))] }, f.factory)).rejects.toThrow('CALCULATION_CONTEXT_MISMATCH');
  });
  it('the server factory matches the live report and freezes its selected chart points', async () => {
    const f = await fixture();
    const prepared = await prepareReportCandidate(f.deps, f.input, reportDocumentFactory(f.deps, f.scopeId));
    const selection = await f.repository.getHistorySelection(f.scopeId, f.input.historySelectionId);
    const arranged = arrangeRounds([{ statement: statement(), file: '합성.xlsx' }]);
    if (!arranged.ok || !selection) throw Error('fixture failed');
    const dashboard = assessDashboard(null, arranged.latest.statement, arranged.latest.statement.defaultBaseMonth);
    const live = buildFinancialReport({ rounds: arranged.rounds, dashboard, gapMonth: basis.gapMonth,
      perception: { ok: false, reason: '합성 산출 불가' }, funding: { ok: false, reason: '합성 조회 실패' },
      generatedAt: new Date(f.input.authoredAt) });
    const projected = withExternalRiskHistory(live, selectionView(selection, evidenceFromJson), { construction: basis.constructionBaseMonth,
      funding: basis.fundingObservedMonth, scopeId: f.scopeId });
    expect(prepared.document.json).toEqual(JSON.parse(JSON.stringify(projected)));
    expect(prepared.document.historyCalculationIds).toEqual(selection.historyCalculationIds);
    const result = await confirmMonthlyReport(f.deps, f.scopeId, { candidateId: prepared.candidateId, expectedRevision: 0, idempotencyKey: 'first-confirmation' });
    if (result.kind !== 'confirmed') throw Error('expected confirmation');
    await f.repository.createHistorySelection({ scopeId: f.scopeId, basis, calculationVersion: HISTORY_CALCULATION_VERSION,
      asOf: '2026-10-26T03:00:00.000Z', selectedBackfillBatchId: null });
    const reselection = vi.spyOn(f.repository, 'createHistorySelection');
    const recalculation = vi.spyOn(f.repository, 'getCalculation');
    const reopened = await openConfirmedReport(f.repository, f.scopeId, result.confirmationId);
    expect(reopened).toEqual(prepared.document);
    expect(reopened.contentHash).toBe(prepared.document.contentHash);
    expect((reopened.json as { generatedOn: string }).generatedOn).toBe('2026.10.24');
    expect((reopened.json as { metrics: unknown }).metrics).toEqual((prepared.document.json as { metrics: unknown }).metrics);
    expect(reselection).not.toHaveBeenCalled();
    expect(recalculation).not.toHaveBeenCalled();
    const opened = await handleConfirmationGet(new Request(`http://localhost/api/report-history/confirmations?confirmationId=${result.confirmationId}`),
      async () => ({ scopeId: f.scopeId, deps: f.deps }));
    expect(opened.status).toBe(200);
    expect((await opened.json()).document).toEqual(prepared.document);
    expect(reselection).not.toHaveBeenCalled();
    expect(recalculation).not.toHaveBeenCalled();
  });
  it('rejects a frozen selection from another effective basis', async () => {
    const f = await fixture();
    const other = await f.repository.createHistorySelection({ scopeId: f.scopeId, basis: { ...basis, gapMonth: yearMonth(2026, 9) },
      calculationVersion: HISTORY_CALCULATION_VERSION, asOf: now, selectedBackfillBatchId: null });
    await expect(prepareReportCandidate(f.deps, { ...f.input, historySelectionId: other.historySelectionId }, f.factory))
      .rejects.toThrow('HISTORY_SELECTION_MISMATCH');
  });
  it('lists confirmations before any file is uploaded and maps malformed snapshots to 422', async () => {
    const f = await fixture();
    const provider = async () => ({ scopeId: f.scopeId, deps: f.deps });
    const list = await handleConfirmationGet(new Request('http://localhost/api/report-history/confirmations'), provider);
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ ok: true, confirmations: [] });
    const invalid = { ...f.input.statements[0], amounts: { ...f.input.statements[0].amounts, 지출: [1] } };
    const request = new Request('http://localhost/api/report-history/confirmations', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'prepare', ...Object.fromEntries(Object.entries(f.input).filter(([key]) => key !== 'scopeId')), statements: [invalid] }) });
    const response = await handleConfirmationPost(request, provider);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, code: 'INVALID_STATEMENT' });
  });
  it('maps an invalid basis month to 422 without a storage retry hint', async () => {
    const f = await fixture();
    const provider = async () => ({ scopeId: f.scopeId, deps: f.deps });
    const request = new Request('http://localhost/api/report-history/confirmations', { method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'prepare', ...Object.fromEntries(Object.entries(f.input).filter(([key]) => key !== 'scopeId')),
        basis: { ...basis, reportCycle: '2026/13' } }) });
    const response = await handleConfirmationPost(request, provider);
    expect(response.status).toBe(422);
    expect(response.headers.get('retry-after')).toBeNull();
    expect(await response.json()).toEqual({ ok: false, code: 'INVALID_MONTH' });
  });
  it('accepts 37 ordered rounds under the existing request-byte limit', async () => {
    const rounds = Array.from({ length: 37 }, (_, index) => {
      const month = addMonths(cycle, index - 36);
      const [year, monthNumber] = month.split('/').map(Number);
      const values = (n: number) => Array.from({ length: 5 }, () => amount(n));
      return createStatement({ asOf: new Date(year, monthNumber - 1, 1), monthLabels: ['-1', '0', '+1', '+2', '+3'], baseMonthIndex: 1,
        planYearEndIndex: 4, amounts: { 기초시재: values(100), 수입계: values(10), 수입: values(10), 분양회수: values(7), 기타수입: values(3), 지출: values(10) } });
    });
    const f = await fixture(rounds);
    const body = { action: 'prepare', ...Object.fromEntries(Object.entries(f.input).filter(([key]) => key !== 'scopeId')) };
    const request = new Request('http://localhost/api/report-history/confirmations', { method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const response = await handleConfirmationPost(request, async () => ({ scopeId: f.scopeId, deps: f.deps }));
    expect(response.status).toBe(200);
    expect((await response.json()).candidate.candidateId).toBeTruthy();
  });
  it('returns all 51 stored summaries so the oldest month remains openable', async () => {
    const f = await fixture();
    const summaries = Array.from({ length: 51 }, (_, index) => ({ confirmationId: `id-${index}`, candidateId: `candidate-${index}`, reportCycle: index === 0 ? yearMonth(2020, 1) : cycle,
      revision: index + 1, confirmedAt: new Date(Date.UTC(2020, 0, index + 1)).toISOString() }));
    vi.spyOn(f.repository, 'listConfirmations').mockResolvedValue(summaries);
    const response = await handleConfirmationGet(new Request('http://localhost/api/report-history/confirmations'),
      async () => ({ scopeId: f.scopeId, deps: f.deps }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.confirmations).toHaveLength(51);
    expect(body.confirmations.some((item: { confirmationId: string }) => item.confirmationId === 'id-0')).toBe(true);
  });
});
