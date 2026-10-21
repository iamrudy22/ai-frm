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
import { Table } from '@astryxdesign/core/Table';
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
  type SummaryStatus,
  type SummaryTile,
} from './summary-view';
import { GRADE_COLOR, money, percent } from './format';
import { DocumentThemeProvider } from '@/app/ThemeProvider';
import { buildFinancialReport } from './report-model';
import { FinancialReportPreview } from './report-preview';
import { INITIAL_UPLOAD_SESSION, uploadSessionReducer, type ReadyRounds as Loaded } from './upload-session';
import { UploadPanel } from './upload-panel';

// ── 표시 헬퍼 ────────────────────────────────────────────────────────────

type Row = { 항목: string; 값: string } & Record<string, unknown>;

const COLUMNS = [
  { key: '항목', header: '항목' },
  { key: '값', header: '값' },
];

// ── 화면 ─────────────────────────────────────────────────────────────────

/**
 * 파일을 고르면 바로 읽는다. 회차를 알아야 산출 전에 빠진 회차를 알릴 수 있다.
 * 산출하기는 읽어 둔 회차로 결과를 펼치기만 한다.
 */
export default function AifrmDashboardPage() {
  const [upload, dispatchUpload] = useReducer(uploadSessionReducer, INITIAL_UPLOAD_SESSION);
  const { files, prepared, committed } = upload;
  const loaded = committed?.rounds ?? null;
  const hasUnappliedFiles = committed !== null && (prepared.kind !== 'ready' || prepared.rounds !== committed.rounds);
  const committedSource = loaded === null ? ''
    : `${roundsText(loaded.rounds.map((round) => round.round))} 회차의 ${loaded.rounds.map((round) => round.file).join(' · ')} 파일`;
  const [reportOpenedAt, setReportOpenedAt] = useState<Date | null>(null);
  const reportWasOpen = useRef(false);
  useEffect(() => {
    if (reportOpenedAt !== null) {
      reportWasOpen.current = true;
      document.getElementById('report-view-heading')?.focus();
    } else if (reportWasOpen.current) {
      reportWasOpen.current = false;
      document.getElementById('report-entry')?.focus();
    }
  }, [reportOpenedAt]);
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

  const handleSubmit = useCallback(() => {
    if (prepared.kind !== 'ready' || loaded === prepared.rounds) return;
    dispatchUpload({ type: 'apply' });
    setGapMonth(prepared.rounds.latest.round);
  }, [prepared, loaded]);

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
  const perception = usePerception(loaded?.latest.statement ?? null, loaded?.rounds ?? null);
  // 판단월 = 최신 회차의 달(대금 회수 위험과 같다). 금리는 그 전달 마지막 평가일 값이다.
  const fundingRisk = useFundingRisk(loaded?.latest.round ?? null);

  const report = useMemo(() => {
    if (reportOpenedAt === null) return null;
    if (loaded === null || dashboard === null || gapMonth === null) return buildFinancialReport();
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

  if (report !== null) {
    return (
      <DocumentThemeProvider>
        <Layout
          contentWidth={960}
          height="auto"
          padding={6}
          content={
            <LayoutContent isScrollable={false}>
              <FinancialReportPreview report={report} onBack={() => setReportOpenedAt(null)} />
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
            <Heading level={1}>자금수지표 등록</Heading>

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

            <VStack gap={1} align="start">
              <Button
                id="report-entry"
                label={loaded === null ? '보고서 양식 미리보기' : 'HTML 보고서 보기'}
                variant={loaded === null ? 'secondary' : 'primary'}
                onClick={() => {
                  setReportOpenedAt(new Date());
                  window.scrollTo({ top: 0 });
                }}
              />
              <Text type="supporting">
                {loaded === null
                  ? '파일을 올리기 전에도 기본 3쪽의 보고서 양식을 볼 수 있습니다.'
                  : perception.isLoading || fundingRisk.response === null
                    ? '외부 자료를 조회하고 있습니다. 보고서에도 진행 상태가 표시됩니다.'
                  : '현재 산출 결과로 보고서를 확인한 뒤 PDF로 저장할 수 있습니다.'}
              </Text>
            </VStack>

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
          description={`${unreadable.map(({ item, reason }) => `${item}: ${reason}`).join(' / ')} 이 항목을 쓰는 지표만 산출하지 않았습니다.`}
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
        이전 회차 파일이 필요합니다. 같은 달을 두 회차에서 읽어 계획과 실적을 견줍니다.
      </Text>
    );
  }

  if (!recovery.ok) {
    return <Banner status="error" title="판정하지 않았습니다" description={recovery.reason} />;
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
      <Text type="supporting" size="xsm">
        {recoveryBasis(judged, target)}: 최신 회차에 적힌 가장 최근 실적(직전 달)을 이전 회차의 같은 달
        계획과 견줍니다. 판단월의 실적은 다음 달 회차에야 나옵니다.
      </Text>
      <Text type="supporting" size="xsm">
        자금수지표의 분양회수 항목을 읽습니다. 수입계나 수입이 아니라 분양 대금 회수만 봅니다 —
        국고보조금·기금·출자금은 걷는 일과 무관합니다.
      </Text>
    </VStack>
  );
}

function GapResult({ gap, gapMonth }: { gap: Outcome<LiquidityGap>; gapMonth: YearMonth | null }) {
  if (!gap.ok) {
    return <Banner status="error" title="산출할 수 없습니다" description={gap.reason} />;
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
  { key: '항목', header: '항목' },
  { key: '합계', header: '3개월 합계' },
  { key: '가중치', header: '가중치' },
  { key: '가중값', header: '가중값' },
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
    return <Banner status="error" title="산출할 수 없습니다" description={adequateCash.reason} />;
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
        </VStack>
      </Collapsible>

      <VStack gap={1}>
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
        <Text type="supporting" size="xsm">
          적정시재 = 분양회수 20% + 기타수입 10% + 지출 10% + 수지차(지출 − 수입) 40%, 각 3개월
          합계. 등급 없이 현재시재가 적정시재 이상이면 안정적, 아니면 적정시재 부족입니다.
        </Text>
      </VStack>
    </VStack>
  );
}
