'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Token } from '@astryxdesign/core/Token';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { proportional, Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import {
  assessDashboard,
  type Dashboard,
  type Outcome,
  type PaymentRecoveryResult,
} from '@/application/dashboard';
import { calendarOf, type Month, type Statement } from '@/domain/cashflow/statement';
import type { AdequateCashMonth } from '@/domain/risk/adequate-cash/adequate-cash';
import { verdictLabel } from '@/domain/risk/adequate-cash/policy';
import {
  LIQUIDITY_WINDOW_MONTHS,
  type LiquidityGap,
} from '@/domain/risk/liquidity-gap/liquidity-gap';
import * as liquidityGapPolicy from '@/domain/risk/liquidity-gap/policy';
import * as paymentRecoveryPolicy from '@/domain/risk/payment-recovery/policy';
import { toPercent } from '@/domain/shared/amount';
import { addMonths, parseYearMonth, type YearMonth } from '@/domain/shared/year-month';
import { roundEntryOf } from '@/domain/cashflow/round-entry';
import { readStatement } from '@/infrastructure/xlsx/statement-reader';
import { ConstructionPerceptionCard, usePerception, type Perception } from './construction-perception-card';
import { FundingRiskCard, useFundingRisk, type FundingRiskState } from './funding-risk-card';
import {
  arrangeRounds,
  roundsText,
  type NamedStatement,
} from './uploaded-rounds';
import { calendarOfLabel, calendarOptions, monthAt, spanText } from './dashboard-view';
import {
  adequateCashTile,
  fundingRiskTile,
  gapTile,
  perceptionTile,
  recoveryBasis,
  recoveryTile,
  reportReadiness,
  type SummaryStatus,
  type SummaryTile,
} from './summary-view';
import { GRADE_COLOR, money, percent } from './format';
import { DocumentThemeProvider } from '@/app/ThemeProvider';
import { buildFinancialReport } from './report-model';
import { FinancialReportPreview } from './report-preview';
import { summarizeHistorySources, withExternalRiskHistory } from './report-history-projection';
import { useReportHistory } from './use-report-history';
import { ReportControlSurface, ReportHistoryControls, ReportHistorySourceSummary } from './report-history-controls';
import type { HistorySourceSummary } from '@/application/report-history/history-view';
import { snapshotStatement, type PreparedCandidate } from '@/application/report-history/report-candidate';
import type { PreparedDocument, ReportBasis } from '@/domain/report-history/report-history';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { FinancialReport } from './report-model';
import { acceptPreparedCandidate, attemptAfterFailureResponse, confirmationAttemptForClick, correctionSuccessState, fetchArchivedDocument, reportDisplayOf, revisionForCycle,
  type AcceptedCandidate, type ConfirmationAttempt } from './report-confirmation-state';
import { ReportCorrectionControls } from './report-correction-editor';
import { ManualEntryControls } from './manual-entry-editor';
import { INITIAL_UPLOAD_SESSION, uploadSessionReducer, type ReadyRounds as Loaded } from './upload-session';
import { UploadPanel } from './upload-panel';

// ── 표시 헬퍼 ────────────────────────────────────────────────────────────

type Row = { 항목: string; 값: string } & Record<string, unknown>;

const COLUMNS = [
  { key: '항목', header: '항목' },
  { key: '값', header: '값' },
];

const CHECK_UPLOAD_SOURCE = '원본 항목·회차를 확인한 뒤 파일을 다시 등록하세요.';

// ── 화면 ─────────────────────────────────────────────────────────────────

/**
 * 파일을 고르면 바로 읽는다. 회차를 알아야 산출 전에 빠진 회차를 알릴 수 있다.
 * 산출하기는 읽어 둔 회차로 결과를 펼치기만 한다.
 */
export default function AifrmDashboardPage() {
  const [upload, dispatchUpload] = useReducer(uploadSessionReducer, INITIAL_UPLOAD_SESSION);
  const { files, prepared, committed } = upload;
  const loaded = committed?.rounds ?? null;
  const resultsFocusPending = useRef(false);
  useEffect(() => {
    if (!resultsFocusPending.current || loaded === null) return;
    resultsFocusPending.current = false;
    const heading = document.getElementById('dashboard-results-heading');
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
  }, [loaded]);
  const hasUnappliedFiles = committed !== null && (prepared.kind !== 'ready' || prepared.rounds !== committed.rounds);
  const committedSource = loaded === null ? ''
    : `${roundsText(loaded.rounds.map((round) => round.round))} 회차의 ${loaded.rounds.map((round) => round.file).join(' · ')} 파일`;
  const [reportOpenedAt, setReportOpenedAt] = useState<Date | null>(null);
  const [archived, setArchived] = useState<{ id: string; document: PreparedDocument; historySources: HistorySourceSummary } | null>(null);
  const [confirmations, setConfirmations] = useState<readonly { confirmationId: string; reportCycle: YearMonth; revision: number; confirmedAt: string }[]>([]);
  const [confirmationsLoaded, setConfirmationsLoaded] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const correctionNavigation = useRef<(() => Promise<boolean>) | null>(null);
  const manualNavigation = useRef<(() => Promise<boolean>) | null>(null);
  const manualStart = useRef<((trigger?:HTMLElement) => void) | null>(null);
  const registerManualStart = useCallback((start: ((trigger?:HTMLElement) => void) | null) => { manualStart.current = start; }, []);
  const registerManualNavigation = useCallback((guard: (() => Promise<boolean>) | null) => { manualNavigation.current = guard; }, []);
  const registerCorrectionNavigation = useCallback((guard: (() => Promise<boolean>) | null) => { correctionNavigation.current = guard; }, []);
  const openGeneration = useRef(0);
  const [correctionRefreshRevision, setCorrectionRefreshRevision] = useState(0);
  const [correctionReason, setCorrectionReason] = useState('');
  const [candidateState, setCandidateState] = useState<AcceptedCandidate | null>(null);
  const [candidatePreparingKey, setCandidatePreparingKey] = useState<string | null>(null);
  const [confirmationAttempt, setConfirmationAttempt] = useState<ConfirmationAttempt | null>(null);
  const [confirmationConflictKey, setConfirmationConflictKey] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ key: string; id: string } | null>(null);
  const [appliedGeneration, setAppliedGeneration] = useState(0);
  const confirmationKeyRef = useRef<string | null>(null);
  const confirmationBusyRef = useRef(false);
  const candidatePreparationRef = useRef<string | null>(null);
  const loadConfirmations = useCallback(async () => {
    setConfirmationsLoaded(false);
    try {
      const response = await fetch('/api/report-history/confirmations', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw Error(body.code ?? 'STORAGE_UNAVAILABLE');
      setConfirmations(body.confirmations);
      setConfirmationsLoaded(true);
      setConfirmationConflictKey(null);
      return true;
    } catch { setConfirmationError('확정 이력을 불러오지 못했습니다. 다시 조회할 수 있습니다.'); return false; }
  }, []);
  useEffect(() => { queueMicrotask(() => void loadConfirmations()); }, [loadConfirmations]);
  const reportWasOpen = useRef(false);
  const archiveWasOpen = useRef(false);
  useEffect(() => {
    if (reportOpenedAt !== null) {
      reportWasOpen.current = true;
      document.getElementById('report-view-heading')?.focus();
    } else if (reportWasOpen.current) {
      reportWasOpen.current = false;
      document.getElementById('report-entry')?.focus();
    }
  }, [reportOpenedAt]);
  useEffect(() => {
    if (archived !== null) {
      archiveWasOpen.current = true;
      document.getElementById('report-view-heading')?.focus();
    } else if (archiveWasOpen.current) {
      archiveWasOpen.current = false;
      document.getElementById('report-entry')?.focus();
    }
  }, [archived]);
  // 유동성 Gap·적정 시재의 기준월(3개월 창의 첫 달). 건설경기 인식 지수의 기준월과 따로다.
  const [gapMonth, setGapMonth] = useState<YearMonth | null>(null);
  // 읽는 중에 파일을 다시 고르면 앞선 읽기의 결과를 버린다.
  const readToken = useRef(0);
  const nextReadId = useCallback(() => ++readToken.current, []);

  const prepare = useCallback(async (list: File[], token: number) => {
    const stale = () => token !== readToken.current;
    if (list.length === 0) return;

    try {
      // 하나라도 못 읽으면 멈춘다. 빠진 회차로 조용히 다른 결과를 내지 않는다.
      const named: NamedStatement[] = [];
      for (const [i, file] of list.entries()) {
        // 파일 하나를 파싱하는 동안(1초 남짓) 화면이 멈춘다. 진행 표시가 먼저 그려지게 한 번 양보한다.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (stale()) return;
        const result = readStatement(await file.arrayBuffer());
        if (stale()) return;
        if (!result.ok) {
          dispatchUpload({ type: 'fail', id: token, reason: `${file.name}을(를) 읽지 못했습니다 — ${result.error}` });
          return;
        }
        named.push({ file: file.name, statement: result.statement });
        dispatchUpload({ type: 'progress', id: token, done: i + 1 });
      }

      const arranged = arrangeRounds(named);
      dispatchUpload(arranged.ok ? { type: 'ready', id: token, rounds: arranged }
        : { type: 'fail', id: token, reason: arranged.reason });
    } catch {
      if (!stale()) dispatchUpload({ type: 'fail', id: token, reason: '파일을 처리하는 중 문제가 생겼습니다.' });
    }
  }, []);

  const handleSubmit = async () => {
    if (manualNavigation.current && !await manualNavigation.current()) return;
    if (correctionNavigation.current && !await correctionNavigation.current()) return;
    if (prepared.kind !== 'ready' || loaded === prepared.rounds) return;
    resultsFocusPending.current = true;
    dispatchUpload({ type: 'apply' });
    setAppliedGeneration(value => value + 1);
    setGapMonth(prepared.rounds.latest.round);
  };

  const restorePrevious = useCallback(() => {
    dispatchUpload({ type: 'restore', id: nextReadId() });
  }, [nextReadId]);

  const baseMonth: Month | null = useMemo(() => {
    if (loaded === null || gapMonth === null) return null;
    return monthAt(loaded.latest.statement, gapMonth);
  }, [loaded, gapMonth]);

  // 기준월을 바꿔도 파일을 다시 읽지 않는다. 이미 읽어 둔 회차로 다시 셈한다.
  // 어느 회차로 어느 지표를 셈하는지, 실패를 어떻게 격리하는지는 유스케이스가 정한다.
  const dashboard = useMemo((): Dashboard | null => {
    if (loaded === null || baseMonth === null) return null;
    return assessDashboard(loaded.previous?.statement ?? null, loaded.latest.statement, baseMonth);
  }, [loaded, baseMonth]);

  // 위쪽 요약과 아래 카드가 같은 결과를 쓴다. 산출 전에는 부르지 않는다.
  const perception = usePerception(archived === null ? loaded?.latest.statement ?? null : null, archived === null ? loaded?.rounds ?? null : null);
  // 판단월 = 최신 회차의 달(대금 회수 위험과 같다). 금리는 그 전달 마지막 평가일 값이다.
  const fundingRisk = useFundingRisk(archived === null ? loaded?.latest.round ?? null : null);
  const readiness = dashboard === null ? null
    : reportReadiness(dashboard, perception.response, perception.isLoading, fundingRisk.response);

  const report = useMemo(() => {
    if (reportOpenedAt === null || loaded === null || dashboard === null || gapMonth === null) return null;
    return buildFinancialReport({
      rounds: loaded.rounds,
      dashboard,
      gapMonth,
      perception: perception.response,
      perceptionLoading: perception.isLoading,
      funding: fundingRisk.response,
      generatedAt: reportOpenedAt,
    });
  }, [reportOpenedAt, loaded, dashboard, gapMonth, perception.response, perception.isLoading, fundingRisk.response]);

  const historyInput = useMemo(() => {
    const rounds = loaded?.rounds ?? [];
    const entries = [] as ReturnType<typeof roundEntryOf>[];
    for (const round of rounds) {
      try { entries.push(roundEntryOf(round.statement)); } catch { /* unreadable rounds remain explicit readiness shortages */ }
    }
    return { entries, unreadable: rounds.length - entries.length };
  }, [loaded]);
  const constructionAnchor = loaded === null ? null : perception.selectedMonth ?? addMonths(loaded.latest.round, -2);
  const history = useReportHistory({ reportCycle: loaded?.latest.round ?? null, constructionAnchor, gapMonth, rounds: loaded === null ? null : historyInput.entries,
    unreadableRounds: historyInput.unreadable, reportOpen: reportOpenedAt !== null && archived === null });
  const projectedReport = useMemo(() => report && history.view && constructionAnchor && loaded
    ? withExternalRiskHistory(report, history.view, { construction: constructionAnchor, funding: addMonths(loaded.latest.round, -1) })
    : report, [report, history.view, constructionAnchor, loaded]);

  const basis: ReportBasis | null = loaded && gapMonth && constructionAnchor ? {
    reportCycle: loaded.latest.round, reportTitleMonth: addMonths(loaded.latest.round, -1), constructionBaseMonth: constructionAnchor,
    fundingJudgedMonth: loaded.latest.round, fundingObservedMonth: addMonths(loaded.latest.round, -1), gapMonth,
  } : null;
  const constructionReceipt = perception.response?.history;
  const fundingReceipt = fundingRisk.response?.history;
  const readyToConfirm = archived === null && projectedReport !== null && loaded !== null && basis !== null && history.view !== null &&
    !perception.isLoading && constructionReceipt?.captureStatus === 'saved' && fundingReceipt?.captureStatus === 'saved' &&
    basis.constructionBaseMonth === addMonths(basis.reportCycle, -2) && basis.gapMonth === basis.reportCycle;
  const statements = loaded?.rounds.map(round => snapshotStatement(round.statement)) ?? [];
  const confirmationKey = readyToConfirm ? JSON.stringify({ generation: appliedGeneration, statements, basis,
    constructionId: constructionReceipt.calculationId, fundingId: fundingReceipt.calculationId,
    selectionId: history.view!.historySelectionId, authoredAt: reportOpenedAt?.toISOString(), report: projectedReport }) : null;
  useEffect(() => { confirmationKeyRef.current = confirmationKey; }, [confirmationKey]);
  const activeCandidate = candidateState?.key === confirmationKey ? candidateState : null;
  useEffect(() => {
    if (!readyToConfirm || !confirmationKey || !basis || !loaded || !reportOpenedAt || !history.view ||
      constructionReceipt?.captureStatus !== 'saved' || fundingReceipt?.captureStatus !== 'saved' || activeCandidate) return;
    const controller = new AbortController();
    const key = confirmationKey;
    const selectionId = history.view.historySelectionId;
    candidatePreparationRef.current = key;
    queueMicrotask(() => { if (!controller.signal.aborted) setCandidatePreparingKey(key); });
    void (async () => {
      try {
        const response = await fetch('/api/report-history/confirmations', { method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'prepare', basis, statements,
            sourceMetadata: { files: loaded.rounds.map(round => round.file) }, constructionCalculationId: constructionReceipt.calculationId,
            fundingCalculationId: fundingReceipt.calculationId, historySelectionId: selectionId,
            authoredAt: reportOpenedAt.toISOString(), inputGeneration: String(appliedGeneration) }) });
        const body = await response.json();
        if (!response.ok) throw Error(body.code ?? 'STORAGE_UNAVAILABLE');
        if (controller.signal.aborted || confirmationKeyRef.current !== key) return;
        const candidate = body.candidate as PreparedCandidate;
        const accepted = acceptPreparedCandidate(confirmationKeyRef.current, key, candidate, projectedReport, () => crypto.randomUUID());
        if (!accepted) return;
        setCandidateState(accepted);
        if (accepted.previewRequired) setConfirmationError('저장할 문서가 표시 중인 내용과 다릅니다. 새 후보를 확인한 뒤 확정해 주세요.');
      } catch (error) {
        if (!controller.signal.aborted && confirmationKeyRef.current === key) setConfirmationError(error instanceof Error ? `보관 실패 · 재시도: ${error.message}` : '보관 실패 · 재시도');
      } finally {
        if (candidatePreparationRef.current === key) candidatePreparationRef.current = null;
        if (!controller.signal.aborted) setCandidatePreparingKey(current => current === key ? null : current);
      }
    })();
    return () => { controller.abort(); if (candidatePreparationRef.current === key) candidatePreparationRef.current = null; };
  // The string key contains every semantic input; an unchanged rerender must not create another immutable candidate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmationKey, readyToConfirm, activeCandidate?.key]);
  const currentRevision = revisionForCycle(confirmations, confirmationsLoaded, basis?.reportCycle ?? null);
  const activeAttempt = confirmationAttempt?.key === confirmationKey ? confirmationAttempt : null;
  const candidatePreparing = confirmationKey !== null && candidatePreparingKey === confirmationKey;
  const { report: displayReport, sources: displayHistorySources } = reportDisplayOf<FinancialReport>(archived, activeCandidate, projectedReport,
    currentReport => history.view ? summarizeHistorySources(currentReport, history.view, 'current') : null);

  const openConfirmation = async (id: string) => {
    if (manualNavigation.current && !await manualNavigation.current()) return;
    if (correctionNavigation.current && !await correctionNavigation.current()) return;
    const generation = ++openGeneration.current;
    setConfirmationError(null);
    try {
      const { document, historySources } = await fetchArchivedDocument(id, history.cancel, fetch, () => generation === openGeneration.current);
      if (generation !== openGeneration.current) return;
      setArchived({ id, document, historySources });
      setReportOpenedAt(null);
      window.scrollTo({ top: 0 });
    } catch { if (generation === openGeneration.current) setConfirmationError('확정본을 열지 못했습니다. 저장소와 버전을 확인해 주세요.'); }
  };
  const confirmReport = async () => {
    if (!readyToConfirm || !confirmationKey || !basis || !loaded || !reportOpenedAt || !history.view ||
      constructionReceipt?.captureStatus !== 'saved' || fundingReceipt?.captureStatus !== 'saved' || confirmationBusyRef.current ||
      candidatePreparationRef.current === confirmationKey || candidatePreparing || confirmationConflictKey === confirmationKey ||
      (currentRevision === null && activeAttempt === null)) return;
    if (!activeAttempt && currentRevision !== null && currentRevision > 0 && !correctionReason.trim()) { setConfirmationError('기존 확정본을 정정하려면 사유를 입력해 주세요.'); return; }
    confirmationBusyRef.current = true; setConfirmationBusy(true); setConfirmationError(null);
    const key = confirmationKey;
    try {
      let state = activeCandidate;
      if (!state) {
        const response = await fetch('/api/report-history/confirmations', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'prepare', basis, statements, sourceMetadata: { files: loaded.rounds.map(round => round.file) },
            constructionCalculationId: constructionReceipt.calculationId, fundingCalculationId: fundingReceipt.calculationId,
            historySelectionId: history.view.historySelectionId, authoredAt: reportOpenedAt.toISOString(), inputGeneration: String(appliedGeneration) }) });
        const body = await response.json();
        if (!response.ok) throw Error(body.code ?? 'STORAGE_UNAVAILABLE');
        if (confirmationKeyRef.current !== key) return;
        const candidate = body.candidate as PreparedCandidate;
        state = acceptPreparedCandidate(confirmationKeyRef.current, key, candidate, projectedReport, () => crypto.randomUUID());
        if (!state) return;
        setCandidateState(state);
        if (state.previewRequired) { setConfirmationError('저장할 문서가 표시 중인 내용과 다릅니다. 새 후보를 확인하고 다시 확정을 눌러 주세요.'); return; }
      }
      const attempt = confirmationAttemptForClick(activeAttempt, key, state.candidate.candidateId, currentRevision ?? activeAttempt!.expectedRevision,
        state.idempotencyKey, correctionReason);
      if (!activeAttempt) setConfirmationAttempt(attempt);
      const response = await fetch('/api/report-history/confirmations', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', candidateId: attempt.candidateId, expectedRevision: attempt.expectedRevision,
          idempotencyKey: attempt.idempotencyKey, ...(attempt.correctionReason ? { correctionReason: attempt.correctionReason } : {}) }) });
      const body = await response.json();
      if (confirmationKeyRef.current !== key) return;
      if (response.status === 409) {
        setConfirmationAttempt(null);
        setConfirmationConflictKey(key);
        setConfirmationError('다른 확정이 먼저 저장되었습니다. 확정 이력을 다시 조회하고 변경된 이력을 확인한 뒤 다시 확정해 주세요.');
        return;
      }
      if (!response.ok || !body.ok) {
        setConfirmationAttempt(current => current?.key === key ? attemptAfterFailureResponse(current, response.status) : current);
        throw Error(body.result?.reason ?? body.code ?? 'STORAGE_UNAVAILABLE');
      }
      setConfirmationAttempt(null);
      setConfirmed({ key, id: body.result.confirmationId });
      await loadConfirmations();
    } catch (error) { if (confirmationKeyRef.current === key) setConfirmationError(error instanceof Error ? `보관 실패 · 재시도: ${error.message}` : '보관 실패 · 재시도'); }
    finally { confirmationBusyRef.current = false; setConfirmationBusy(false); }
  };

  const correctionConfirmed = (id: string) => {
    const next = correctionSuccessState({ candidateState, candidatePreparingKey, confirmationKey: confirmationKeyRef.current,
      candidatePreparationKey: candidatePreparationRef.current, confirmationAttempt, confirmationConflictKey, confirmed,
      archived, appliedGeneration, correctionRefreshRevision });
    history.invalidateSelection();
    confirmationKeyRef.current = next.confirmationKey;
    candidatePreparationRef.current = next.candidatePreparationKey;
    setCandidateState(next.candidateState);
    setCandidatePreparingKey(next.candidatePreparingKey);
    setConfirmationAttempt(next.confirmationAttempt);
    setConfirmationConflictKey(next.confirmationConflictKey);
    setConfirmed(next.confirmed);
    setArchived(next.archived);
    setAppliedGeneration(next.appliedGeneration);
    setCorrectionRefreshRevision(next.correctionRefreshRevision);
    void loadConfirmations();
    void openConfirmation(id);
  };
  const confirmationControls = (inReport: boolean) => <VStack as="section" aria-label="보고서 확정·이력" className="report-controls" gap={2}>
    <ManualEntryControls onConfirmed={correctionConfirmed} refreshRevision={correctionRefreshRevision} registerStart={registerManualStart} registerNavigationGuard={registerManualNavigation}/>
    <ReportCorrectionControls onNewManualEntry={trigger => void (async () => { if (correctionNavigation.current && !await correctionNavigation.current()) return; manualStart.current?.(trigger); })()} confirmations={confirmations} onOpen={id => void openConfirmation(id)} onConfirmed={correctionConfirmed} refreshRevision={correctionRefreshRevision} registerNavigationGuard={registerCorrectionNavigation} />
    {inReport && archived === null && <VStack gap={2} align="start">
      {currentRevision !== null && currentRevision > 0 && <TextInput label="정정 사유" value={correctionReason} onChange={setCorrectionReason} isRequired />}
      <Button label={confirmationBusy ? '확정 중' : candidatePreparing ? '후보 준비 중' : currentRevision !== null && currentRevision > 0 ? '정정 확정' : '보고서 확정'} variant="secondary"
        isLoading={confirmationBusy || candidatePreparing} isDisabled={!readyToConfirm || (currentRevision === null && activeAttempt === null) || confirmationConflictKey === confirmationKey} onClick={() => void confirmReport()} />
      {currentRevision === null && activeAttempt === null && <Text type="supporting">확정 이력을 조회해야 현재 월의 확정 차수를 확인할 수 있습니다.</Text>}
      {!readyToConfirm && <Text type="supporting">{basis && (basis.constructionBaseMonth !== addMonths(basis.reportCycle, -2) || basis.gapMonth !== basis.reportCycle)
        ? '선택한 월은 열람할 수 있지만 월별 확정의 기본 월 조합이 아닙니다.' : '산출 응답과 이력 선택의 보관이 끝나면 확정할 수 있습니다.'}</Text>}
      {confirmed?.key === confirmationKey && <Text role="status">확정됨</Text>}
    </VStack>}
    {confirmationError && <Banner status="warning" title="확정 이력 안내" description={confirmationError} />}
  </VStack>;

  if (displayReport !== null && displayReport !== undefined) {
    return (
      <DocumentThemeProvider>
        <Layout
          contentWidth={960}
          height="auto"
          padding={6}
          content={
            <LayoutContent isScrollable={false}>
              <VStack gap={3}>
                <ReportControlSurface>
                  {archived && displayHistorySources ? <ReportHistorySourceSummary summary={displayHistorySources} archived /> :
                    <ReportHistoryControls history={history} summary={displayHistorySources} />}
                  {confirmationControls(true)}
                </ReportControlSurface>
                <FinancialReportPreview report={displayReport} onBack={() => { void (async () => { if (manualNavigation.current && !await manualNavigation.current()) return;
    if (correctionNavigation.current && !await correctionNavigation.current()) return; openGeneration.current++; setArchived(null); setReportOpenedAt(null); })(); }} />
              </VStack>
            </LayoutContent>
          }
        />
      </DocumentThemeProvider>
    );
  }

  return (
    <Layout
      contentWidth={960}
      padding={6}
      content={
        <LayoutContent>
          <VStack gap={6}>
            <Heading level={1}>{loaded === null ? '자금수지표 등록' : '재무위험 확인'}</Heading>
            <ReportHistoryControls history={history} summary={displayHistorySources} />
            {confirmationControls(false)}

            <UploadPanel
              files={files}
              prepared={prepared}
              isApplied={prepared.kind === 'ready' && loaded === prepared.rounds}
              onFilesChange={(picked) => {
                const list = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
                const id = nextReadId();
                dispatchUpload({ type: 'select', id, files: list });
                void prepare(list, id);
              }}
              onSubmit={handleSubmit}
            />

            {prepared.kind === 'error' && (
              <Banner status="error" title="새 파일을 확인하지 못했습니다" description={prepared.reason} />
            )}

            {hasUnappliedFiles && loaded !== null && (
              <Banner
                status="info"
                title={prepared.kind === 'empty' ? '파일 선택을 해제했습니다' : '새 파일이 아직 결과에 반영되지 않았습니다'}
                description={prepared.kind === 'empty'
                  ? `이전 결과와 보고서는 ${committedSource} 원본을 계속 사용합니다. 다른 파일을 고르거나 이전 선택으로 돌아갈 수 있습니다.`
                  : `현재 결과와 보고서는 ${committedSource} 원본을 사용합니다. 새 파일의 회차를 확인한 뒤 산출하기를 누르면 결과가 바뀝니다.`}
                endContent={<Button label="이전 결과로 돌아가기" variant="secondary" onClick={restorePrevious} />}
              />
            )}

            {loaded !== null && dashboard !== null && readiness !== null && <VStack gap={1} align="start">
              <Heading level={2} id="dashboard-results-heading" tabIndex={-1}>산출 결과</Heading>
              <Button
                id="report-entry"
                label="HTML 보고서 보기"
                variant="primary"
                onClick={async () => {
                  if (manualNavigation.current && !await manualNavigation.current()) return;
    if (correctionNavigation.current && !await correctionNavigation.current()) return;
                  setReportOpenedAt(new Date());
                  window.scrollTo({ top: 0 });
                }}
              />
              <Text type="supporting"
                role="status" aria-live="polite" aria-atomic aria-label="보고서 준비 상태">
                {`지표 5개 중 ${[
                  readiness.completed > 0 ? `${readiness.completed}개 산출 완료` : null,
                  readiness.loading > 0 ? `${readiness.loading}개 조회 중` : null,
                  readiness.unavailable > 0 ? `${readiness.unavailable}개 산출 불가` : null,
                ].filter(Boolean).join(' · ')}`}
              </Text>
            </VStack>}

            {dashboard !== null && <Diagnostics diagnostics={dashboard.diagnostics} />}

            {loaded !== null && dashboard !== null && (
              <VStack gap={6}>
                <Summary tiles={summaryTiles(loaded, dashboard, gapMonth, perception, fundingRisk.response)} />

                <Divider />

                <VStack gap={3}>
                  <Heading level={2} id="risk-recovery" tabIndex={-1}>대금 회수 위험</Heading>
                  <RecoveryResult
                    recovery={dashboard.paymentRecovery}
                    statement={loaded.latest.statement}
                    judged={loaded.latest.round}
                  />
                </VStack>

                <Divider />

                <VStack gap={5}>
                  <VStack gap={3} align="start">
                    <Heading level={2} id="risk-liquidity" tabIndex={-1}>유동성 Gap · 적정 시재</Heading>
                    <Selector
                      label="Gap·시재 기준월"
                      description={`${LIQUIDITY_WINDOW_MONTHS}개월 창의 첫 달입니다. 기본값은 최신 회차의 기준월입니다`}
                      options={calendarOptions(loaded.latest.statement)}
                      value={gapMonth ?? undefined}
                      onChange={(value) => setGapMonth(parseYearMonth(value))}
                    />
                  </VStack>

                  <VStack gap={3}>
                    <Heading level={3}>유동성 Gap</Heading>
                    <GapResult gap={dashboard.liquidityGap} gapMonth={gapMonth} />
                  </VStack>

                  <VStack gap={3}>
                    <Heading level={3} id="risk-cash" tabIndex={-1}>적정 시재</Heading>
                    <AdequateCashResult adequateCash={dashboard.adequateCash} statement={loaded.latest.statement} />
                  </VStack>
                </VStack>
              </VStack>
            )}

            {loaded !== null && (
              <>
                <Divider />
                <ConstructionPerceptionCard perception={perception} />
                <Divider />
                <FundingRiskCard fundingRisk={fundingRisk} />
              </>
            )}
          </VStack>
        </LayoutContent>
      }
    />
  );
}

// ── 요약 ─────────────────────────────────────────────────────────────────

function summaryTiles(
  loaded: Loaded,
  dashboard: Dashboard,
  gapMonth: YearMonth | null,
  perception: Perception,
  fundingRisk: FundingRiskState['response'],
): SummaryTile[] {
  const statement = loaded.latest.statement;
  const recovery = dashboard.paymentRecovery;
  const target =
    recovery?.ok && recovery.value.targetMonthLabel !== undefined
      ? calendarOfLabel(statement, recovery.value.targetMonthLabel)
      : null;
  const adequate = dashboard.adequateCash;
  return [
    recoveryTile(recovery, { judged: loaded.latest.round, target, previousRound: addMonths(loaded.latest.round, -1) }),
    gapTile(dashboard.liquidityGap, gapMonth === null ? '—' : spanText(gapMonth, LIQUIDITY_WINDOW_MONTHS)),
    adequateCashTile(adequate, adequate.ok ? windowText(statement, adequate.value) : '—'),
    perceptionTile(perception.response, perception.isLoading, perception.selectedMonth),
    fundingRiskTile(fundingRisk),
  ];
}

const RESULT_TARGETS: Record<string, string> = {
  '대금 회수 위험': 'risk-recovery',
  '유동성 Gap': 'risk-liquidity',
  '적정 시재': 'risk-cash',
  '건설경기 인식 지수': 'risk-construction',
  '조달위험 인식 지수': 'risk-funding',
};

/** 다섯 요약과 상세 이동. 좁은 화면에서는 카드 줄을 바꾼다. */
function Summary({ tiles }: { tiles: readonly SummaryTile[] }) {
  return (
    <Grid gap={4} columns={{ minWidth: 160, repeat: 'fit' }}>
      {tiles.map((tile) => (
        <Card key={tile.title}>
          <VStack gap={2}>
            <Text type="label">{tile.title}</Text>
            {tile.status.kind === 'grade' && <StatusMark status={tile.status} />}
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text type="display-3">{tile.value}</Text>
              {tile.status.kind === 'dot' && <StatusMark status={tile.status} />}
            </HStack>
            <Text type="supporting" size="xsm">
              {tile.note}
            </Text>
            {RESULT_TARGETS[tile.title] && (
              <Button label="상세 보기" aria-label={`${tile.title} 상세 보기`} variant="ghost" size="sm"
                href={`#${RESULT_TARGETS[tile.title]}`}
                onClick={(event) => {
                  event.preventDefault();
                  const heading = document.getElementById(RESULT_TARGETS[tile.title]);
                  heading?.focus();
                  heading?.scrollIntoView({ block: 'start' });
                }} />
            )}
          </VStack>
        </Card>
      ))}
    </Grid>
  );
}

function StatusMark({ status }: { status: SummaryStatus }) {
  if (status.kind === 'grade') return <Token color={GRADE_COLOR[status.grade]} label={status.grade} />;
  return (
    <HStack gap={2} vAlign="center">
      <StatusDot variant={status.variant} label={status.label} />
      <Text type="supporting">{status.label}</Text>
    </HStack>
  );
}

// ── 진단 ─────────────────────────────────────────────────────────────────

// 판정을 막지 않는 신호들. 결과보다 위에 두어 결과를 읽기 전에 보이게 한다.
function Diagnostics({ diagnostics }: { diagnostics: Dashboard['diagnostics'] }) {
  const { order, rollForward, unreadable } = diagnostics;

  return (
    <>
      {order !== null && !order.ok && (
        <Banner
          status="warning"
          title="회차 순서를 확인해 주세요"
          description={`${order.reason} 대금 회수 위험은 서로 다른 달을 비교하게 되므로 판정하지 않았습니다. 유동성 Gap은 최신 회차 자리에 올린 파일로 산출했습니다.`}
        />
      )}
      {unreadable.length > 0 && (
        <Banner
          status="warning"
          title="최신 회차에서 읽지 못한 항목이 있습니다"
          description={`${unreadable.map(({ item, reason }) => `${item}: ${reason}`).join(' / ')} 이 항목을 쓰는 지표만 산출하지 않았습니다. 표시된 원본 항목을 확인한 뒤 파일을 다시 등록하세요.`}
        />
      )}
      {rollForward.length > 0 && (
        <Banner
          status="warning"
          title="시재가 다음 달로 이어지지 않습니다"
          description={`${rollForward.join(' ')} 판독이 엉뚱한 행을 읽었을 수 있습니다.`}
        />
      )}
    </>
  );
}

// ── 결과 ─────────────────────────────────────────────────────────────────

function RecoveryResult({
  recovery,
  statement,
  judged,
}: {
  recovery: Outcome<PaymentRecoveryResult> | null;
  statement: Statement;
  /** 판단월 = 최신 회차의 달. */
  judged: YearMonth;
}) {
  if (recovery === null) {
    return (
      <Text type="supporting">
        이전 회차({addMonths(judged, -1)}) 파일을 최신 회차와 함께 등록하세요. 같은 달을 두 회차에서 읽어 계획과 실적을 견줍니다.
      </Text>
    );
  }

  if (!recovery.ok) {
    return <Banner status="error" title="판정하지 않았습니다" description={`${recovery.reason} ${CHECK_UPLOAD_SOURCE}`} />;
  }

  return <RecoveryDetail recovery={recovery.value} statement={statement} judged={judged} />;
}

function RecoveryDetail({
  recovery,
  statement,
  judged,
}: {
  recovery: PaymentRecoveryResult;
  statement: Statement;
  judged: YearMonth;
}) {
  const label = recovery.targetMonthLabel;
  const target = label === undefined ? null : calendarOfLabel(statement, label);
  const rows: Row[] = [
    { 항목: '판단월', 값: judged },
    { 항목: '실적 기준월', 값: target ?? '—' },
    { 항목: '계획값 (분양회수)', 값: money(recovery.plan) },
    { 항목: '실적값 (분양회수)', 값: money(recovery.actual) },
    { 항목: '회수율', 값: percent(toPercent(recovery.rate)) },
  ];

  return (
    <VStack gap={3} align="start">
      <Token color={GRADE_COLOR[recovery.grade]} label={recovery.grade} />
      <Table data={rows} columns={COLUMNS} />
      <Text type="supporting">{paymentRecoveryPolicy.commentFor(recovery.grade)}</Text>
      <Collapsible trigger="산출 기준" defaultIsOpen={false}>
        <VStack gap={2}>
          <Text type="supporting" size="xsm">
            {recoveryBasis(judged, target)}: 최신 회차에 적힌 가장 최근 실적(직전 달)을 이전 회차의 같은 달
            계획과 견줍니다. 판단월의 실적은 다음 달 회차에야 나옵니다.
          </Text>
          <Text type="supporting" size="xsm">
            자금수지표의 분양회수 항목을 읽습니다. 수입계나 수입이 아니라 분양 대금 회수만 봅니다 —
            국고보조금·기금·출자금은 걷는 일과 무관합니다.
          </Text>
        </VStack>
      </Collapsible>
    </VStack>
  );
}

function GapResult({ gap, gapMonth }: { gap: Outcome<LiquidityGap>; gapMonth: YearMonth | null }) {
  if (!gap.ok) {
    return <Banner status="error" title="산출할 수 없습니다" description={`${gap.reason} ${CHECK_UPLOAD_SOURCE}`} />;
  }

  return <GapDetail gap={gap.value} gapMonth={gapMonth} />;
}

function GapDetail({ gap, gapMonth }: { gap: LiquidityGap; gapMonth: YearMonth | null }) {
  const windowLabel = gapMonth === null ? '—' : spanText(gapMonth, LIQUIDITY_WINDOW_MONTHS);

  const rows: Row[] =
    gap.kind === 'gap'
      ? [
          { 항목: '관측 구간', 값: windowLabel },
          { 항목: '기초시재', 값: money(gap.openingCash) },
          { 항목: '수입 합계', 값: money(gap.income) },
          { 항목: '지출 합계', 값: money(gap.expense) },
          { 항목: '순지출', 값: money(gap.netOutflow) },
          { 항목: '유동성 Gap', 값: percent(toPercent(gap.gapRatio)) },
        ]
      : [
          { 항목: '관측 구간', 값: windowLabel },
          { 항목: '기초시재', 값: money(gap.openingCash) },
          { 항목: '수입 합계', 값: money(gap.income) },
          { 항목: '지출 합계', 값: money(gap.expense) },
          { 항목: '순유입', 값: money(gap.netInflow) },
          { 항목: '유동성 Gap', 값: '해당 없음 (순유입)' },
        ];

  return (
    <VStack gap={3} align="start">
      <Token color={GRADE_COLOR[gap.grade]} label={gap.grade} />
      <Table data={rows} columns={COLUMNS} />
      <Text type="supporting">{liquidityGapPolicy.commentFor(gap.grade)}</Text>
      <Text type="supporting" size="xsm">
        수입은 운영 수입 기준입니다. 공사채·금융기관 차입은 빼고 셉니다 — 조달은 유동성 위험의
        해결책이지 완충재가 아니기 때문입니다.
      </Text>
    </VStack>
  );
}

// ── 적정 시재 ────────────────────────────────────────────────────────────
//
// 적정 시재에는 등급이 없다. T/F와 '안정적'/'적정시재 부족' 표기만 쓴다.
// 두 지표의 등급 배지·색(BADGE_VARIANT)과 등급별 코멘트를 쓰지 않는다 —
// 같은 모양이면 등급이 있는 지표로 읽히기 때문이다.

function verdictText(isAdequate: boolean): string {
  return `${isAdequate ? 'T' : 'F'} · ${verdictLabel(isAdequate)}`;
}

function windowText(statement: Statement, m: AdequateCashMonth): string {
  return `${calendarOf(statement, m.month)}~${calendarOf(statement, m.windowEnd)}`;
}

function remarkText(m: AdequateCashMonth): string {
  return [m.isPlan ? '계획' : null, m.beyondPlanYear ? '다음 해 계획 미확정' : null]
    .filter((x) => x !== null)
    .join(' · ');
}

type BreakdownRow = { 항목: string; 합계: string; 가중치: string; 가중값: string } & Record<string, unknown>;

const BREAKDOWN_COLUMNS = [
  { key: '항목', header: '항목', width: proportional(1) },
  { key: '합계', header: '3개월 합계', width: proportional(1) },
  { key: '가중치', header: '가중치', width: proportional(1) },
  { key: '가중값', header: '가중값', width: proportional(1) },
];

// 고른 기준월 한 달치만 보여 준다. 8월 기준이면 8월만 — 다음 달들의 추이는 내지 않는다.
function AdequateCashResult({
  adequateCash,
  statement,
}: {
  adequateCash: Outcome<AdequateCashMonth>;
  statement: Statement;
}) {
  if (!adequateCash.ok) {
    return <Banner status="error" title="산출할 수 없습니다" description={`${adequateCash.reason} ${CHECK_UPLOAD_SOURCE}`} />;
  }

  const current = adequateCash.value;
  const remark = remarkText(current);

  const summary: Row[] = [
    { 항목: '관측 구간', 값: windowText(statement, current) },
    { 항목: '현재시재 (기초시재)', 값: money(current.openingCash) },
    { 항목: '적정시재 (LCR)', 값: money(current.adequateCash) },
    { 항목: '차이 (현재 − 적정)', 값: money(current.surplus) },
    { 항목: '적정 여부', 값: verdictText(current.isAdequate) },
  ];

  const breakdown: BreakdownRow[] = [
    ...current.components.map((c) => ({
      항목: c.key === '수지차' ? '수지차 (지출 − 수입)' : c.key,
      합계: money(c.total),
      가중치: `${Math.round(c.weight * 100)}%`,
      가중값: money(c.weighted),
    })),
    { 항목: '적정시재', 합계: '', 가중치: '', 가중값: money(current.adequateCash) },
  ];

  return (
    <VStack gap={3} align="start">
      <HStack gap={2} vAlign="center">
        <StatusDot
          variant={current.isAdequate ? 'success' : 'warning'}
          label={verdictLabel(current.isAdequate)}
        />
        <Text>{verdictText(current.isAdequate)}</Text>
        {remark !== '' && <Text type="supporting">({remark})</Text>}
      </HStack>

      <Table data={summary} columns={COLUMNS} />

      {/* 표가 부모의 첫·마지막 자식이면 Astryx가 위아래로 번지게(bleed) 그려 트리거와 겹친다.
          설명 문장을 앞뒤에 두어 표를 가운데 자식으로 둔다. */}
      <Collapsible trigger="산출 내역" defaultIsOpen={false}>
        <VStack gap={2}>
          <Text type="supporting" size="xsm">
            각 항목의 3개월 합계에 가중치를 곱해 더한 값이 적정시재입니다.
          </Text>
          <Table data={breakdown} columns={BREAKDOWN_COLUMNS} />
          <Text type="supporting" size="xsm">
            수입은 자금조달을 뺀 수입 행입니다. 자금조달은 산식에 넣지 않습니다.
          </Text>
          <Text type="supporting" size="xsm">
            적정시재 = 분양회수 20% + 기타수입 10% + 지출 10% + 수지차(지출 − 수입) 40%, 각 3개월
            합계. 등급 없이 현재시재가 적정시재 이상이면 안정적, 아니면 적정시재 부족입니다.
          </Text>
        </VStack>
      </Collapsible>

      {(current.isPlan || current.beyondPlanYear) && <VStack gap={1}>
        {current.isPlan && (
          <Text type="supporting" size="xsm">
            계획: 회차 기준월 뒤의 달입니다. 기초시재가 계획된 조달까지 포함한 이월 잔고라서,
            안정적 판정은 계획대로 조달한다는 전제 위에 있습니다.
          </Text>
        )}
        {current.beyondPlanYear && (
          <Text type="supporting" size="xsm">
            다음 해 계획 미확정: 3개월 창이 다음 해 열에 걸칩니다. 다음 해 계획이 일부만 입력되어
            있어 적정시재가 작게 나올 수 있습니다.
          </Text>
        )}
      </VStack>}
    </VStack>
  );
}
