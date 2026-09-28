'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Divider } from '@astryxdesign/core/Divider';
import { FileInput } from '@astryxdesign/core/FileInput';
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
import { readStatement } from '@/infrastructure/xlsx/statement-reader';
import { ConstructionPerceptionCard, usePerception } from './construction-perception-card';
import {
  arrangeRounds,
  requirementsOf,
  roundsText,
  type ArrangedRounds,
  type NamedStatement,
  type UploadedRound,
} from './uploaded-rounds';
import { calendarOfLabel, calendarOptions, monthAt, spanText } from './dashboard-view';
import {
  adequateCashTile,
  gapTile,
  perceptionTile,
  recoveryTile,
  type SummaryStatus,
  type SummaryTile,
} from './summary-view';
import { GRADE_BADGE, money, percent } from './format';

// ── 표시 헬퍼 ────────────────────────────────────────────────────────────

const BADGE_VARIANT = GRADE_BADGE;

type Row = { 항목: string; 값: string } & Record<string, unknown>;

const COLUMNS = [
  { key: '항목', header: '항목' },
  { key: '값', header: '값' },
];

/** 읽어 정리한 회차 묶음. 최신·이전 회차와 올린 회차 전부(회차 순서). */
type Loaded = Extract<ArrangedRounds, { ok: true }>;

type RoundRow = { 회차: string; 쓰임: string; 파일: string } & Record<string, unknown>;

const ROUND_COLUMNS = [
  { key: '회차', header: '회차', width: proportional(1) },
  { key: '쓰임', header: '쓰임', width: proportional(2) },
  { key: '파일', header: '파일', width: proportional(2) },
];

const ROLE_TEXT: Record<UploadedRound['role'], string> = {
  '최신 회차': '최신 회차 — 유동성 Gap·적정 시재 기준, 대금 회수 위험 실적',
  '이전 회차': '이전 회차 — 대금 회수 위험 계획',
  분양회수: '건설경기 인식 지수(분양회수)만',
};

// ── 화면 ─────────────────────────────────────────────────────────────────

/**
 * 파일을 고르면 바로 읽는다. 회차를 알아야 산출 전에 빠진 회차를 알릴 수 있다.
 * 산출하기는 읽어 둔 회차로 결과를 펼치기만 한다.
 */
type Prepared =
  | { readonly kind: 'empty' }
  | { readonly kind: 'reading'; readonly done: number; readonly total: number }
  | { readonly kind: 'error'; readonly reason: string }
  | { readonly kind: 'ready'; readonly rounds: Loaded };

export default function AifrmDashboardPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [prepared, setPrepared] = useState<Prepared>({ kind: 'empty' });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // 유동성 Gap·적정 시재의 기준월(3개월 창의 첫 달). 건설경기 인식 지수의 기준월과 따로다.
  const [gapMonth, setGapMonth] = useState<YearMonth | null>(null);
  // 읽는 중에 파일을 다시 고르면 앞선 읽기의 결과를 버린다.
  const readToken = useRef(0);

  const prepare = useCallback(async (list: File[]) => {
    const token = ++readToken.current;
    const stale = () => token !== readToken.current;
    if (list.length === 0) {
      setPrepared({ kind: 'empty' });
      return;
    }

    setPrepared({ kind: 'reading', done: 0, total: list.length });
    try {
      // 하나라도 못 읽으면 멈춘다. 빠진 회차로 조용히 다른 결과를 내지 않는다.
      const named: NamedStatement[] = [];
      for (const [i, file] of list.entries()) {
        // 파일 하나를 파싱하는 동안(1초 남짓) 화면이 멈춘다. 진행 표시가 먼저 그려지게 한 번 양보한다.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const result = readStatement(await file.arrayBuffer());
        if (stale()) return;
        if (!result.ok) {
          setPrepared({ kind: 'error', reason: `${file.name}을(를) 읽지 못했습니다 — ${result.error}` });
          return;
        }
        named.push({ file: file.name, statement: result.statement });
        setPrepared({ kind: 'reading', done: i + 1, total: list.length });
      }

      const arranged = arrangeRounds(named);
      setPrepared(arranged.ok ? { kind: 'ready', rounds: arranged } : { kind: 'error', reason: arranged.reason });
    } catch {
      if (!stale()) setPrepared({ kind: 'error', reason: '파일을 처리하는 중 문제가 생겼습니다.' });
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (prepared.kind !== 'ready') return;
    setLoaded(prepared.rounds);
    setGapMonth(prepared.rounds.latest.round);
  }, [prepared]);

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

  return (
    <Layout
      contentWidth={960}
      padding={6}
      content={
        <LayoutContent>
          <VStack gap={6}>
            <VStack gap={1}>
              <Heading level={1}>재무위험 선행지표</Heading>
              <Text type="supporting">
                자금수지표 회차를 올리면 대금 회수 위험·유동성 Gap·적정 시재와 건설경기 인식 지수를
                함께 판정합니다. 올린 파일은 저장하지 않습니다.
              </Text>
            </VStack>

            <VStack gap={3} align="start">
              <FileInput
                label="자금수지표 회차"
                description="최신 회차와 그 전 회차들을 한 번에 올리세요. 고르면 바로 읽어 지표마다 필요한 회차가 있는지 알려 드립니다."
                placeholder="자금수지표 파일 선택(여러 개)"
                accept=".xlsx,.xls"
                isMultiple
                value={files}
                onChange={(picked) => {
                  const list = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
                  setFiles(list);
                  setLoaded(null);
                  setGapMonth(null);
                  void prepare(list);
                }}
              />

              {prepared.kind === 'ready' && <Requirements rounds={prepared.rounds} />}

              <Button
                label={prepared.kind === 'reading' ? `읽는 중… ${prepared.done}/${prepared.total}` : '산출하기'}
                variant="primary"
                isDisabled={prepared.kind !== 'ready' || loaded === prepared.rounds}
                onClick={handleSubmit}
              />
            </VStack>

            {prepared.kind === 'error' && (
              <Banner status="error" title="판정할 수 없습니다" description={prepared.reason} />
            )}

            {dashboard !== null && <Diagnostics diagnostics={dashboard.diagnostics} />}

            {loaded !== null && dashboard !== null && (
              <VStack gap={6}>
                <Summary tiles={summaryTiles(loaded, dashboard, gapMonth, perception.response)} />

                <Divider />

                <VStack gap={3}>
                  <Heading level={2}>대금 회수 위험</Heading>
                  <RecoveryResult recovery={dashboard.paymentRecovery} statement={loaded.latest.statement} />
                </VStack>

                <Divider />

                <VStack gap={5}>
                  <VStack gap={3} align="start">
                    <Heading level={2}>유동성 Gap · 적정 시재</Heading>
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
                    <Heading level={3}>적정 시재</Heading>
                    <AdequateCashResult adequateCash={dashboard.adequateCash} statement={loaded.latest.statement} />
                  </VStack>
                </VStack>
              </VStack>
            )}

            {loaded !== null && (
              <>
                <Divider />
                <ConstructionPerceptionCard perception={perception} />
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
  perception: Parameters<typeof perceptionTile>[0],
): SummaryTile[] {
  const statement = loaded.latest.statement;
  const recovery = dashboard.paymentRecovery;
  const target =
    recovery?.ok && recovery.value.targetMonthLabel !== undefined
      ? calendarOfLabel(statement, recovery.value.targetMonthLabel)
      : null;
  const adequate = dashboard.adequateCash;
  return [
    recoveryTile(recovery, { target, previousRound: addMonths(loaded.latest.round, -1) }),
    gapTile(dashboard.liquidityGap, gapMonth === null ? '—' : spanText(gapMonth, LIQUIDITY_WINDOW_MONTHS)),
    adequateCashTile(adequate, adequate.ok ? windowText(statement, adequate.value) : '—'),
    perceptionTile(perception),
  ];
}

/** 네 지표를 먼저 한 줄로. 상세는 아래 섹션에 있다. */
function Summary({ tiles }: { tiles: readonly SummaryTile[] }) {
  return (
    <Grid gap={4} columns={{ minWidth: 200, repeat: 'fit' }}>
      {tiles.map((tile) => (
        <Card key={tile.title}>
          <VStack gap={2}>
            <Text type="label">{tile.title}</Text>
            <HStack>
              <StatusMark status={tile.status} />
            </HStack>
            <Text type="display-3">{tile.value}</Text>
            <Text type="supporting" size="xsm">
              {tile.note}
            </Text>
          </VStack>
        </Card>
      ))}
    </Grid>
  );
}

function StatusMark({ status }: { status: SummaryStatus }) {
  if (status.kind === 'grade') return <Badge variant={BADGE_VARIANT[status.grade]} label={status.grade} />;
  return (
    <HStack gap={2} vAlign="center">
      <StatusDot variant={status.variant} label={status.label} />
      <Text type="supporting">{status.label}</Text>
    </HStack>
  );
}

// ── 필요한 회차 ──────────────────────────────────────────────────────────

type RequirementRow = { 지표: string; 회차: string; 상태: string; ok: boolean } & Record<string, unknown>;

const REQUIREMENT_COLUMNS = [
  { key: '지표', header: '지표', width: proportional(2) },
  { key: '회차', header: '필요한 회차', width: proportional(1) },
  {
    key: '상태',
    header: '올린 회차',
    width: proportional(2),
    renderCell: (row: RequirementRow) => (
      <HStack gap={2} vAlign="center">
        <StatusDot variant={row.ok ? 'success' : 'warning'} label={row.ok ? '있음' : '없음'} />
        <Text>{row.상태}</Text>
      </HStack>
    ),
  },
];

/**
 * 산출 전에 지표마다 필요한 회차가 올라왔는지 보인다. 빠진 회차가 있어도 산출은 막지 않는다 —
 * 그 지표만 산출불가가 되고 나머지는 나온다.
 */
function Requirements({ rounds }: { rounds: Loaded }) {
  const rows: RequirementRow[] = requirementsOf(rounds.rounds.map((r) => r.round)).map((req) => ({
    지표: req.indicator,
    회차: roundsText(req.needed),
    상태: req.missing.length === 0 ? '모두 있음' : `${roundsText(req.missing)} 없음 — ${req.ifMissing}`,
    ok: req.missing.length === 0,
  }));

  return (
    <VStack gap={2}>
      <Text type="supporting" size="xsm">
        올린 회차 {rounds.rounds.length}개: {roundsText(rounds.rounds.map((r) => r.round))} (최신 {rounds.latest.round}).
        건설경기 기준월은 산출 뒤 바꿀 수 있고, 그러면 필요한 회차도 바뀝니다.
      </Text>
      <Table data={rows} columns={REQUIREMENT_COLUMNS} />
      <Collapsible trigger="파일별 회차" defaultIsOpen={false}>
        <VStack gap={2}>
          <Text type="supporting" size="xsm">
            회차는 파일 기준일의 달입니다. 올린 순서와 상관없이 회차 순서로 씁니다.
          </Text>
          <Table data={roundRows(rounds.rounds)} columns={ROUND_COLUMNS} />
          <Text type="supporting" size="xsm">
            파일을 바꾸려면 위에서 다시 고르세요.
          </Text>
        </VStack>
      </Collapsible>
    </VStack>
  );
}

function roundRows(rounds: readonly UploadedRound[]): RoundRow[] {
  return [...rounds].reverse().map((r) => ({ 회차: r.round, 쓰임: ROLE_TEXT[r.role], 파일: r.file }));
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
}: {
  recovery: Outcome<PaymentRecoveryResult> | null;
  statement: Statement;
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

  return <RecoveryDetail recovery={recovery.value} statement={statement} />;
}

function RecoveryDetail({ recovery, statement }: { recovery: PaymentRecoveryResult; statement: Statement }) {
  const target = recovery.targetMonthLabel;
  const rows: Row[] = [
    { 항목: '판정 대상월', 값: target === undefined ? '—' : (calendarOfLabel(statement, target) ?? target) },
    { 항목: '계획값 (분양회수)', 값: money(recovery.plan) },
    { 항목: '실적값 (분양회수)', 값: money(recovery.actual) },
    { 항목: '회수율', 값: percent(toPercent(recovery.rate)) },
  ];

  return (
    <VStack gap={3} align="start">
      <Badge variant={BADGE_VARIANT[recovery.grade]} label={recovery.grade} />
      <Table data={rows} columns={COLUMNS} />
      <Text type="supporting">{paymentRecoveryPolicy.commentFor(recovery.grade)}</Text>
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
      <Badge variant={BADGE_VARIANT[gap.grade]} label={gap.grade} />
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
