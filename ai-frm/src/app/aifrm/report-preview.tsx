'use client';

import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { proportional, Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import type { Band, Grade } from '@/domain/risk/grade';
import { PAYMENT_RECOVERY_BANDS } from '@/domain/risk/payment-recovery/policy';
import { LIQUIDITY_GAP_BANDS } from '@/domain/risk/liquidity-gap/policy';
import { SCORING_RULES, STAGE_BANDS } from '@/domain/risk/construction-perception/policy';
import { FUNDING_RISK_BANDS } from '@/domain/risk/funding-risk/policy';
import { LCR_WEIGHTS } from '@/domain/risk/adequate-cash/policy';
import { ReportChart } from './report-chart';
import type { FinancialReport, ReportMetric } from './report-model';

type CriterionRow = { indicator: string; 정상: string; 주의: string; 경고: string; 위기: string } & Record<string, unknown>;

function threshold(value: number, unit: '%' | '%p' | '점'): string {
  const display = unit === '%' ? value * 100 : value;
  return `${Number(display.toFixed(8))}${unit}`;
}

function intervals(bands: readonly Band[], unit: '%' | '%p' | '점'): Record<Grade, string> {
  const result = {} as Record<Grade, string>;
  for (const [index, band] of bands.entries()) {
    const upper = index === 0 ? null : bands[index - 1].atLeast;
    result[band.grade] = [
      Number.isFinite(band.atLeast) ? `${threshold(band.atLeast, unit)} 이상` : null,
      upper === null ? null : `${threshold(upper, unit)} 미만`,
    ].filter(Boolean).join(' · ');
  }
  return result;
}

const CRITERIA: CriterionRow[] = [
  { indicator: '대금 회수 위험 = 실적 ÷ 계획', ...intervals(PAYMENT_RECOVERY_BANDS, '%') },
  { indicator: '유동성 Gap = 기초시재 ÷ 향후 3개월 순지출', ...intervals(LIQUIDITY_GAP_BANDS, '%') },
  { indicator: '건설경기 인식 지수 = 10개 지표의 점수 × 가중치 합계', ...intervals(STAGE_BANDS, '점') },
  { indicator: '조달위험 인식 지수 = 공사채 AAA 1년 − 국고채 1년 금리', ...intervals(FUNDING_RISK_BANDS, '%p') },
];

const CRITERIA_COLUMNS = [
  { key: 'indicator', header: '관리지표 및 산식', width: proportional(2) },
  ...(['정상', '주의', '경고', '위기'] as Grade[]).map((grade) => ({
    key: grade,
    header: grade,
    width: proportional(1),
    renderCell: (row: CriterionRow) => <Text size="xsm" color="inherit">{row[grade]}</Text>,
  })),
];

type WeightRow = { first: string; firstWeight: string; second: string; secondWeight: string } & Record<string, unknown>;
const WEIGHTS: WeightRow[] = SCORING_RULES.slice(0, 5).map((rule, index) => ({
  first: rule.key,
  firstWeight: String(Number(rule.weight.toFixed(4))),
  second: SCORING_RULES[index + 5].key,
  secondWeight: String(Number(SCORING_RULES[index + 5].weight.toFixed(4))),
}));

const WEIGHT_COLUMNS = [
  { key: 'first', header: '구성 지표', width: proportional(1) },
  { key: 'firstWeight', header: '가중치', width: proportional(1) },
  { key: 'second', header: '구성 지표', width: proportional(1) },
  { key: 'secondWeight', header: '가중치', width: proportional(1) },
];

function statusClass(metric: ReportMetric): string {
  if (metric.grade === '정상') return 'text-report-blue!';
  if (metric.grade !== null || metric.status === '적정시재 부족') return 'text-report-crisis!';
  return 'text-report-ink';
}

function Sheet({ children, page, last = false, className = '' }: {
  children: ReactNode; page: number; last?: boolean; className?: string;
}) {
  return (
    <VStack as="section" gap={5} padding={8} width="100%" maxWidth="210mm" minHeight="297mm"
      className={`report-sheet self-center bg-report-paper text-report-ink ${last ? 'report-sheet-last' : ''} ${className}`}
      aria-label={`보고서 ${page}쪽`}>
      {children}
      <Text size="xsm" color="inherit" justify="center" className="report-page-number">{page}</Text>
    </VStack>
  );
}

/** 표시 문구만 축약하며 원본 모델과 유니코드 코드 포인트는 보존한다. */
function abbreviate(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length <= limit ? text : `${characters.slice(0, limit - 1).join('')}…`;
}

function shortReason(reason: string): string {
  const short = abbreviate(reason, 60);
  return short === reason ? reason : `${short} (상세는 HTML 참고)`;
}

function MetricSection({ metric }: { metric: ReportMetric }) {
  const hasFailure = metric.status === '산출 불가' || metric.status === '산출 중';
  return (
    <VStack as="section" gap={2} className="break-inside-avoid wrap-anywhere" aria-label={metric.title}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Heading level={3} color="inherit" className="text-base">○ {metric.title}</Heading>
        <Text type="label" color="inherit" hasTabularNumbers>{metric.value}</Text>
        <Text type="label" color="inherit" className={statusClass(metric)}>[{metric.status}]</Text>
      </HStack>
      <Text size="sm" color="inherit" className={hasFailure ? 'report-screen-details' : undefined}>- {metric.narrative}</Text>
      {hasFailure && <Text size="sm" color="inherit" className="report-print-summary">- {shortReason(metric.narrative)}</Text>}
      {metric.id === 'construction' && <Text size="xsm" color="inherit">기준: {metric.basis}</Text>}
      <Text size="xsm" color="inherit">* {metric.formula}</Text>
      <VStack gap={1} className="report-metric-chart">
        <ReportChart metric={hasFailure ? { ...metric, narrative: shortReason(metric.narrative) } : metric} />
      </VStack>
    </VStack>
  );
}

function ReferencePage() {
  return (
    <Sheet page={3} last>
      <HStack className="border-b! border-solid border-report-line!" paddingBlockEnd={2}>
        <Text type="label" color="inherit" className="text-report-blue!">참고</Text>
      </HStack>
      <VStack gap={3} className="[&>.astryx-table-scroll-wrapper]:mb-0!">
        <Heading level={2} color="inherit" className="text-lg">□ 위험단계 기준</Heading>
        <Table data={CRITERIA} columns={CRITERIA_COLUMNS} density="compact" dividers="grid" />
      </VStack>
      <VStack gap={3} className="break-inside-avoid [&>.astryx-table-scroll-wrapper]:mb-0!">
        <Heading level={3} color="inherit" className="text-base">건설경기 인식 지수 구성</Heading>
        <Table data={WEIGHTS} columns={WEIGHT_COLUMNS} density="compact" dividers="grid" />
      </VStack>
      <VStack gap={3} className="break-inside-avoid">
        <Heading level={2} color="inherit" className="text-lg">□ 적정시재 산정방식 (LCR 방식)</Heading>
        <VStack padding={3} className="border! border-solid border-report-ink/40!">
          <Text size="sm" color="inherit">
            적정시재 = 향후 3개월 분양회수 × {LCR_WEIGHTS.분양회수 * 100}%
            {' + '}기타수입 × {LCR_WEIGHTS.기타수입 * 100}%
            {' + '}지출 × {LCR_WEIGHTS.지출 * 100}%
            {' + '}수지차(지출 − 수입) × {LCR_WEIGHTS.수지차 * 100}%
          </Text>
        </VStack>
      </VStack>
    </Sheet>
  );
}

export function FinancialReportPreview({ report, onBack }: { report: FinancialReport; onBack?: () => void }) {
  const loadingCount = report.metrics.filter((item) => item.status === '산출 중').length;
  const unavailableCount = report.metrics.filter((item) => item.status === '산출 불가').length;
  const calculationStatus = report.isTemplate ? '산출 전'
    : loadingCount === 0 && unavailableCount === 0 ? `지표 ${report.metrics.length}개 산출 완료`
      : `산출 중 ${loadingCount}개 · 산출 불가 ${unavailableCount}개`;
  const metric = (id: ReportMetric['id']) => report.metrics.find((item) => item.id === id);
  const recovery = metric('recovery');
  const liquidity = metric('liquidity');
  const construction = metric('construction');
  const funding = metric('funding');
  const cash = metric('cash');

  return (
    <VStack as="article" gap={5} className="report-root text-report-ink" aria-label="재무위험관리 HTML 보고서">
      <VStack gap={2} padding={3}
        className="report-controls sticky! top-0! z-10 min-w-0 bg-report-paper border-b! border-solid border-report-ink/30!">
        <HStack gap={2} wrap="wrap" vAlign="center" hAlign="between">
          <Heading level={2} color="inherit" className="text-lg" id="report-view-heading" tabIndex={-1}>HTML 보고서</Heading>
          <Text size="sm" color="inherit" role="status" aria-label="PDF 출력 구성">PDF 출력: 3쪽</Text>
        </HStack>
        <HStack gap={2} wrap="wrap" vAlign="center" hAlign="between">
          <Text size="sm" color="inherit" role="status" aria-label="지표 산출 상태">{calculationStatus}</Text>
          <HStack gap={2} wrap="wrap">
            {onBack && <Button label="대시보드로 돌아가기" variant="secondary" size="sm" onClick={onBack} />}
            <Button label="인쇄 / PDF 저장" variant="primary" size="sm" onClick={() => window.print()} />
          </HStack>
        </HStack>
      </VStack>
      <Sheet page={1}>
        <VStack as="header" gap={2}>
          <VStack paddingBlock={3} className="border-y-4! border-solid border-report-blue!">
            <Heading level={1} color="inherit" justify="center" className="text-2xl">{report.title}</Heading>
          </VStack>
          <Text size="sm" color="inherit" justify="end">({report.generatedOn}, 자금기획팀)</Text>
        </VStack>

        <VStack gap={3}>
          <Heading level={2} color="inherit" className="text-lg">□ 재무위험지수 종합</Heading>
          <HStack gap={3} padding={3} wrap="wrap" className="bg-report-summary border! border-solid border-report-ink/30!">
            {report.metrics.map((item) => (
              <HStack gap={1} key={item.id} vAlign="center" wrap="wrap">
                <Text type="label" color="inherit" size="sm">◇ {item.title}</Text>
                <Text type="label" color="inherit" size="sm" className={statusClass(item)}>({item.status})</Text>
              </HStack>
            ))}
          </HStack>
        </VStack>

        <VStack gap={4}>
          <Heading level={2} color="inherit" className="text-lg">□ 위험수준 측정결과</Heading>
          {recovery && <MetricSection metric={recovery} />}
          {liquidity && <MetricSection metric={liquidity} />}
        </VStack>
      </Sheet>

      <Sheet page={2}>
        {construction && <MetricSection metric={construction} />}
        {funding && <MetricSection metric={funding} />}
        {cash && (
          <VStack gap={3} className="break-inside-avoid">
            <Heading level={2} color="inherit" className="text-lg">□ 적정시재 산정결과</Heading>
            <MetricSection metric={cash} />
          </VStack>
        )}
      </Sheet>

      <ReferencePage />
    </VStack>
  );
}
