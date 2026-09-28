'use client';

import { useCallback, useMemo, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Divider } from '@astryxdesign/core/Divider';
import { FileInput } from '@astryxdesign/core/FileInput';
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
import type { Month, Statement } from '@/domain/cashflow/statement';
import type { AdequateCashMonth } from '@/domain/risk/adequate-cash/adequate-cash';
import { verdictLabel } from '@/domain/risk/adequate-cash/policy';
import {
  LIQUIDITY_WINDOW_MONTHS,
  type LiquidityGap,
} from '@/domain/risk/liquidity-gap/liquidity-gap';
import * as liquidityGapPolicy from '@/domain/risk/liquidity-gap/policy';
import * as paymentRecoveryPolicy from '@/domain/risk/payment-recovery/policy';
import { toPercent } from '@/domain/shared/amount';
import { readStatement } from '@/infrastructure/xlsx/statement-reader';
import { ConstructionPerceptionCard } from './construction-perception-card';
import { GRADE_BADGE, money, percent } from './format';

// ── 표시 헬퍼 ────────────────────────────────────────────────────────────

const BADGE_VARIANT = GRADE_BADGE;

type Row = { 항목: string; 값: string } & Record<string, unknown>;

const COLUMNS = [
  { key: '항목', header: '항목' },
  { key: '값', header: '값' },
];

type Loaded = {
  readonly previous: Statement | null;
  readonly latest: Statement;
};

// ── 화면 ─────────────────────────────────────────────────────────────────

export default function AifrmDashboardPage() {
  const [previousFile, setPreviousFile] = useState<File | null>(null);
  const [latestFile, setLatestFile] = useState<File | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [baseMonthLabel, setBaseMonthLabel] = useState<string | null>(null);

  const reset = useCallback(() => {
    setLoaded(null);
    setError(null);
    setBaseMonthLabel(null);
  }, []);

  const pickFile = useCallback((files: File | File[] | null): File | null => {
    if (files === null) return null;
    return Array.isArray(files) ? (files[0] ?? null) : files;
  }, []);

  const handleSubmit = useCallback(async () => {
    if (latestFile === null) {
      setError('최신 회차 파일을 올려 주세요. 유동성 Gap은 가장 최근 회차로 판정합니다.');
      return;
    }

    setIsReading(true);
    reset();

    try {
      const latestResult = readStatement(await latestFile.arrayBuffer());
      if (!latestResult.ok) {
        setError(`최신 회차를 읽지 못했습니다 — ${latestResult.error}`);
        return;
      }

      let previous: Statement | null = null;

      if (previousFile !== null) {
        const previousResult = readStatement(await previousFile.arrayBuffer());
        if (!previousResult.ok) {
          setError(`이전 회차를 읽지 못했습니다 — ${previousResult.error}`);
          return;
        }
        previous = previousResult.statement;
      }

      setLoaded({ previous, latest: latestResult.statement });
      setBaseMonthLabel(latestResult.statement.defaultBaseMonth.label);
    } catch {
      setError('파일을 처리하는 중 문제가 생겼습니다.');
    } finally {
      setIsReading(false);
    }
  }, [latestFile, previousFile, reset]);

  const baseMonth: Month | null = useMemo(() => {
    if (loaded === null || baseMonthLabel === null) return null;
    return loaded.latest.months.find((m) => m.label === baseMonthLabel) ?? null;
  }, [loaded, baseMonthLabel]);

  // 기준월을 바꿔도 파일을 다시 읽지 않는다. 이미 읽어 둔 회차로 다시 셈한다.
  // 어느 회차로 어느 지표를 셈하는지, 실패를 어떻게 격리하는지는 유스케이스가 정한다.
  const dashboard = useMemo((): Dashboard | null => {
    if (loaded === null || baseMonth === null) return null;
    return assessDashboard(loaded.previous, loaded.latest, baseMonth);
  }, [loaded, baseMonth]);

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
                자금수지표 회차를 올리면 대금 회수 위험·유동성 Gap·적정 시재를 함께 판정합니다. 건설경기
                인식 지수는 한국은행 ECOS 지표로 따로 산출하며, 올린 최신 회차의 분양회수를 이력에
                더합니다.
              </Text>
            </VStack>

            <Grid gap={4} columns={{ minWidth: 280, repeat: 'fit' }}>
              <FileInput
                label="이전 회차"
                description="대금 회수 위험 판정에만 씁니다. 없으면 유동성 Gap만 나옵니다."
                placeholder="자금수지표 파일 선택"
                accept=".xlsx,.xls"
                value={previousFile}
                onChange={(files) => {
                  setPreviousFile(pickFile(files));
                  reset();
                }}
              />
              <FileInput
                label="최신 회차"
                description="유동성 Gap과 적정 시재의 기준이 됩니다."
                placeholder="자금수지표 파일 선택"
                accept=".xlsx,.xls"
                value={latestFile}
                onChange={(files) => {
                  setLatestFile(pickFile(files));
                  reset();
                }}
              />
            </Grid>

            <HStack>
              <Button
                label={isReading ? '읽는 중…' : '산출하기'}
                variant="primary"
                isDisabled={isReading || latestFile === null}
                onClick={handleSubmit}
              />
            </HStack>

            {error !== null && (
              <Banner status="error" title="판정할 수 없습니다" description={error} />
            )}

            {dashboard !== null && <Diagnostics diagnostics={dashboard.diagnostics} />}

            {loaded !== null && dashboard !== null && (
              <VStack gap={6}>
                <Selector
                  label={`기준월 (${LIQUIDITY_WINDOW_MONTHS}개월 창의 첫 달)`}
                  options={loaded.latest.months.map((m) => m.label)}
                  value={baseMonthLabel ?? undefined}
                  onChange={setBaseMonthLabel}
                />

                <Divider />

                <VStack gap={3}>
                  <Heading level={2}>대금 회수 위험</Heading>
                  <RecoveryResult recovery={dashboard.paymentRecovery} />
                </VStack>

                <Divider />

                <VStack gap={3}>
                  <Heading level={2}>유동성 Gap</Heading>
                  <GapResult gap={dashboard.liquidityGap} baseMonth={baseMonth} />
                </VStack>

                <Divider />

                <VStack gap={3}>
                  <Heading level={2}>적정 시재</Heading>
                  <AdequateCashResult adequateCash={dashboard.adequateCash} />
                </VStack>
              </VStack>
            )}

            <Divider />

            <ConstructionPerceptionCard latest={loaded?.latest ?? null} isReading={isReading} />
          </VStack>
        </LayoutContent>
      }
    />
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

function RecoveryResult({ recovery }: { recovery: Outcome<PaymentRecoveryResult> | null }) {
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

  return <RecoveryDetail recovery={recovery.value} />;
}

function RecoveryDetail({ recovery }: { recovery: PaymentRecoveryResult }) {
  const rows: Row[] = [
    { 항목: '판정 대상월', 값: recovery.targetMonthLabel ?? '—' },
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

function GapResult({ gap, baseMonth }: { gap: Outcome<LiquidityGap>; baseMonth: Month | null }) {
  if (!gap.ok) {
    return <Banner status="error" title="산출할 수 없습니다" description={gap.reason} />;
  }

  return <GapDetail gap={gap.value} baseMonth={baseMonth} />;
}

function GapDetail({ gap, baseMonth }: { gap: LiquidityGap; baseMonth: Month | null }) {
  const windowLabel = `${baseMonth?.label ?? '—'}부터 ${LIQUIDITY_WINDOW_MONTHS}개월`;

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

function windowText(m: AdequateCashMonth): string {
  return `${m.month.label}~${m.windowEnd.label}`;
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
function AdequateCashResult({ adequateCash }: { adequateCash: Outcome<AdequateCashMonth> }) {
  if (!adequateCash.ok) {
    return <Banner status="error" title="산출할 수 없습니다" description={adequateCash.reason} />;
  }

  const current = adequateCash.value;
  const remark = remarkText(current);

  const summary: Row[] = [
    { 항목: '관측 구간', 값: windowText(current) },
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
