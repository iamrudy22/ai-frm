'use client';

import { useCallback, useMemo, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
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
import type { Grade } from '@/domain/risk/grade';
import {
  LIQUIDITY_WINDOW_MONTHS,
  type LiquidityGap,
} from '@/domain/risk/liquidity-gap/liquidity-gap';
import * as liquidityGapPolicy from '@/domain/risk/liquidity-gap/policy';
import * as paymentRecoveryPolicy from '@/domain/risk/payment-recovery/policy';
import { toPercent } from '@/domain/shared/amount';
import { readStatement } from '@/infrastructure/xlsx/statement-reader';

// ── 표시 헬퍼 ────────────────────────────────────────────────────────────

const BADGE_VARIANT: Record<Grade, 'success' | 'warning' | 'orange' | 'error'> = {
  정상: 'success',
  주의: 'warning',
  경고: 'orange',
  위기: 'error',
};

const money = (n: number) => `${n.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} 억원`;
const percent = (n: number) => `${n.toFixed(1)}%`;

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
                자금수지표 회차를 올리면 대금 회수 위험과 유동성 Gap을 함께 판정합니다.
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
                description="유동성 Gap의 기준이 됩니다."
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
              </VStack>
            )}
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
