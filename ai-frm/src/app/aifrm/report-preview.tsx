'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
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
import { ReportChart, StatementReferenceChart } from './report-chart';
import type { FinancialReport, ReportMetric } from './report-model';
import type { ReferencePoint, StatementReferenceTrends } from './report-reference';

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
  if (metric.grade === '정상') return 'text-report-status-normal!';
  if (metric.grade !== null || metric.status === '적정시재 부족') return 'text-report-status-alert!';
  return 'text-report-ink';
}

function Sheet({ children, page, last = false, className = '' }: {
  children: ReactNode; page: number; last?: boolean; className?: string;
}) {
  return (
    <VStack as="section" gap={5} padding={4} width="100%" maxWidth="210mm" minHeight="297mm"
      className={`report-sheet min-w-0 self-center bg-report-paper text-report-ink sm:p-8! print:p-0! ${last ? 'report-sheet-last' : ''} ${className}`}
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

function coverageText(metric: ReportMetric): string {
  const coverage = metric.historyCoverage;
  const count = coverage.availableMonths.length;
  return [count === 1 ? `${coverage.availableMonths[0]}의 1개월 값 확보`
    : count > 1 ? `산출값 ${count}개월 확보` : '',
  coverage.notApplicableMonths.length > 0 ? `비율 비적용 ${coverage.notApplicableMonths.length}개월` : '',
  coverage.missingMonths.length > 0 ? `결측 ${coverage.missingMonths.length}개월` : ''].filter(Boolean).join(' · ');
}

function MetricSection({ metric }: { metric: ReportMetric }) {
  const value = (metric.id === 'recovery' || metric.id === 'liquidity')
    && metric.value.trim() !== '' && Number.isFinite(Number(metric.value))
    ? `${metric.value} 배` : metric.value;
  const coverage = coverageText(metric);
  const reasons = [...new Set(metric.points.flatMap((point) => point.kind === 'available' ? [] : [point.reason]))];
  const printReason = reasons.length > 1
    ? `${abbreviate(reasons[0], 60)} · 추가 사유 ${reasons.length - 1}종 (상세는 HTML 참고)`
    : reasons.length === 1 ? shortReason(reasons[0]) : '';
  const hasFailure = metric.status === '산출 불가' || metric.status === '산출 중';
  return (
    <VStack as="section" gap={2} className="min-w-0 break-inside-avoid wrap-anywhere" aria-label={metric.title}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Heading level={3} color="inherit" className="text-base">○ {metric.title}</Heading>
        <Text type="label" color="inherit" hasTabularNumbers>{value}</Text>
        <Text type="label" color="inherit" className={statusClass(metric)}>[{metric.status}]</Text>
      </HStack>
      <Text size="sm" color="inherit" className={hasFailure ? 'report-screen-details' : undefined}>- {metric.narrative}</Text>
      {hasFailure && <Text size="sm" color="inherit" className="report-print-summary">- {shortReason(metric.narrative)}</Text>}
      <Text size="xsm" color="inherit">기준: {metric.basis}</Text>
      <Text size="xsm" color="inherit">* {metric.formula}</Text>
      {coverage && <Text size="xsm" color="inherit">자료 상태: {coverage}</Text>}
      <VStack gap={1} className="report-metric-chart min-w-0">
        <ReportChart metric={hasFailure ? { ...metric, narrative: shortReason(metric.narrative) } : metric} />
        <Text size="xsm" color="inherit" className="report-print-summary">
          {metric.id === 'construction' || metric.id === 'funding'
            ? '확보한 외부 응답의 기준월만 표시 · 과거 산출 이력 미조회'
            : '회차 기준월의 당시 계획 · 본문 선택 기준월과 독립 · 최대 18개월 · 결측·비적용 월은 연결하지 않음'}
        </Text>
      </VStack>
      {reasons.length > 0 && (
        <details className="report-screen-details wrap-anywhere">
          <summary>이력의 결측·비적용 사유 상세</summary>
          <VStack gap={1}>
            {metric.points.filter((point) => point.kind !== 'available').map((point) => (
              <Text key={point.month} size="xsm" color="inherit">
                {point.month} · {point.kind === 'not-applicable' ? '비율 비적용' : '결측'}: {'reason' in point ? point.reason : ''}
              </Text>
            ))}
          </VStack>
        </details>
      )}
      {!hasFailure && reasons.length > 0 && (
        <Text size="xsm" color="inherit" className="report-print-summary">
          {printReason}
        </Text>
      )}
      <Text size="xsm" color="inherit">자료: {metric.source}</Text>
    </VStack>
  );
}

function ReferencePage({ last }: { last: boolean }) {
  return (
    <Sheet page={3} last={last}>
      <HStack className="border-b! border-solid border-report-line!" paddingBlockEnd={2}>
        <Text type="label" color="inherit" className="text-report-status-normal!">참고</Text>
      </HStack>
      <VStack gap={3}>
        <Heading level={2} color="inherit" className="text-lg">□ 위험단계 기준</Heading>
        <Table data={CRITERIA} columns={CRITERIA_COLUMNS} density="compact" dividers="grid" />
        <Text size="xsm" color="inherit">
          경계값은 ‘이상’ 구간에 포함합니다. 유동성 Gap은 3개월 순유입일 때 정상으로 판정하며 비율을 표시하지 않습니다.
          조달위험은 비율이 아닌 금리 차이(%p)입니다.
        </Text>
      </VStack>
      <VStack gap={3} className="break-inside-avoid">
        <Heading level={3} color="inherit" className="text-base">건설경기 인식 지수 구성</Heading>
        <Text size="xsm" color="inherit">
          각 구성 지표의 변화율을 정책표에 따라 0~1점으로 환산한 뒤 가중치를 곱해 합산합니다.
          가중치는 소수점 넷째 자리까지 표시하며, 계산에는 반올림 전 값을 사용합니다.
        </Text>
        <Table data={WEIGHTS} columns={WEIGHT_COLUMNS} density="compact" dividers="grid" />
        <Text size="xsm" color="inherit">
          가중치 합계: {SCORING_RULES.reduce((total, rule) => total + rule.weight, 0).toFixed(4)}.
          보고월과 외부 통계 기준월은 발표 시차 때문에 다를 수 있으므로 각 지표의 기준월을 확인합니다.
        </Text>
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
        <Text size="xsm" color="inherit">
          각 항목은 3개월 합계이며 자금조달은 수입에서 제외합니다. 현재시재가 적정시재 이상이면 ‘안정적’,
          미만이면 ‘적정시재 부족’입니다. 적정시재에는 위험 등급을 부여하지 않습니다.
        </Text>
      </VStack>
      <Text size="xsm" color="inherit">기준 출처: 현재 시스템의 지표별 판정 정책. 금액 단위: 억원.</Text>
    </Sheet>
  );
}

function natureText(point: ReferencePoint, sourceRound: StatementReferenceTrends['sourceRound']): string {
  return point.nature === 'actual' ? '실적' : point.nature === 'planned-opening-balance' ? '계획 이월 잔고'
    : point.nature === 'opening-balance' ? `${point.month === sourceRound ? '기준월 ' : ''}월초 잔고` : '계획';
}

function StatementReferencePage({ trend }: { trend: StatementReferenceTrends }) {
  const source = abbreviate(trend.sourceFile, 48);
  const omissions = ([['앞', trend.window.omittedBefore], ['뒤', trend.window.omittedAfter]] as const)
    .flatMap(([position, range]) => range === null ? [] : [`${position} 생략: ${range.from}~${range.to} (${range.count}개월)`]);
  return (
    <Sheet page={4} last className="report-reference-sheet">
      <VStack as="header" gap={2}>
        <Heading level={2} color="inherit" className="text-lg">□ 최신 파일의 월별 금액 참고자료</Heading>
        <Text size="xsm" color="inherit">{trend.note}</Text>
        <Text size="xsm" color="inherit" className="report-screen-details wrap-anywhere">출처: {trend.sourceFile} · {trend.sourceRound} 회차</Text>
        <Text size="xsm" color="inherit" className="report-print-summary report-print-source">출처: {source} · {trend.sourceRound} 회차</Text>
        <Text size="xsm" color="inherit">단위: {trend.unit} · 기준월: {trend.sourceRound} · 표시: {trend.window.from}~{trend.window.to} (최대 18개 월열)</Text>
        <Text size="xsm" color="inherit">{omissions.length > 0 ? omissions.join(' · ') : '앞·뒤 생략 없음'}</Text>
      </VStack>
      {trend.charts.map((chart) => {
        const missing = chart.series.flatMap((series) => [...new Set(series.points.flatMap((point) => point.kind === 'missing' ? [point.reason] : []))]
          .map((reason) => ({ item: series.item, reason })));
        const coverage = chart.series.map((series) => `${series.item}: 확보 ${series.points.filter((point) => point.kind === 'available').length}개월 · 결측 ${series.points.filter((point) => point.kind === 'missing').length}개월`).join(' / ');
        const beyond = chart.series.some((series) => series.points.some((point) => point.beyondPlanYear));
        return (
          <VStack as="section" key={chart.id} gap={1} className="report-reference-chart min-w-0 break-inside-avoid wrap-anywhere" aria-label={`${chart.series.map((series) => series.item).join('·')} 참고자료`}>
            <StatementReferenceChart trend={trend} chart={chart} />
            <Text size="xsm" color="inherit">자료 상태: {coverage}</Text>
            <Text size="xsm" color="inherit" className="report-print-summary">
              실적 실선 · 계획 점선 · {chart.id === 'opening-cash' ? `${trend.sourceRound} 기준월 잔고 이후는 계획 이월 잔고` : `계획은 ${trend.sourceRound}부터`}{beyond ? ' · 다음 해 미확정 계획 포함' : ''}
            </Text>
            {missing.map(({ item, reason }) => <Text key={`${item}-${reason}`} size="xsm" color="inherit" className="report-print-summary report-print-reason">{item} 결측: {shortReason(reason)}</Text>)}
            <details className="report-screen-details wrap-anywhere">
              <summary>출처·월별 상태·전체 결측 사유 상세</summary>
              <VStack gap={1}>
                <Text size="xsm" color="inherit">원본 파일: {trend.sourceFile} · {trend.sourceRound} 회차 · 단위: {trend.unit}</Text>
                <Text size="xsm" color="inherit">월 순번은 소계 제거 후 1부터 세며, 엑셀 열 번호·셀 좌표가 아닙니다.</Text>
                {chart.series.flatMap((series) => series.points.map((point) => (
                  <Text key={`${series.item}-${point.month}`} size="xsm" color="inherit">
                    {point.month} · {series.item} · 월 순번 {point.source.statementMonthIndex + 1} ({point.source.monthLabel}) · {natureText(point, trend.sourceRound)}
                    {point.beyondPlanYear ? ' · 다음 해 미확정 계획' : ''} · {point.kind === 'missing' ? `결측: ${point.reason}` : `${Number(point.value).toLocaleString('ko-KR')} ${trend.unit}`}
                  </Text>
                )))}
              </VStack>
            </details>
          </VStack>
        );
      })}
    </Sheet>
  );
}

export function FinancialReportPreview({ report, onBack }: { report: FinancialReport; onBack?: () => void }) {
  const [includeReferenceInPrint, setIncludeReferenceInPrint] = useState(false);
  const hasReference = report.referenceTrends !== null;
  const loadingCount = report.metrics.filter((item) => item.status === '산출 중').length;
  const unavailableCount = report.metrics.filter((item) => item.status === '산출 불가').length;
  const calculationStatus = report.isTemplate ? '양식 미리보기 · 실제 산출값 없음'
    : loadingCount === 0 && unavailableCount === 0 ? `지표 ${report.metrics.length}개 산출 완료`
      : `산출 중 ${loadingCount}개 · 산출 불가 ${unavailableCount}개`;
  const printPages = hasReference && includeReferenceInPrint ? 4 : 3;
  const metric = (id: ReportMetric['id']) => report.metrics.find((item) => item.id === id);
  const recovery = metric('recovery');
  const liquidity = metric('liquidity');
  const construction = metric('construction');
  const funding = metric('funding');
  const cash = metric('cash');

  return (
    <VStack as="article" gap={5} className="report-root min-w-0 text-report-ink" aria-label="재무위험관리 HTML 보고서"
      data-include-reference-in-print={includeReferenceInPrint}>
      <VStack gap={2} padding={3}
        className="report-controls sticky! top-0! z-10 min-w-0 bg-report-paper border-b! border-solid border-report-ink/30!">
        <HStack gap={2} wrap="wrap" vAlign="center" hAlign="between">
          <Heading level={2} color="inherit" className="text-lg" id="report-view-heading" tabIndex={-1}>HTML 보고서</Heading>
          <Text size="sm" color="inherit" role="status" aria-label="PDF 출력 구성">{`PDF 출력: ${printPages}쪽`}</Text>
        </HStack>
        <HStack gap={2} wrap="wrap" vAlign="center" hAlign="between">
          <Text size="sm" color="inherit" role="status" aria-label="지표 산출 상태">{calculationStatus}</Text>
          <HStack gap={2} wrap="wrap">
            {onBack && <Button label="대시보드로 돌아가기" variant="secondary" size="sm" onClick={onBack} />}
            <Button label="인쇄 / PDF 저장" variant="primary" size="sm" onClick={() => window.print()} />
          </HStack>
        </HStack>
      </VStack>
      <VStack gap={2} padding={4} className="report-controls bg-report-paper">
        <Text size="sm" color="inherit">인쇄 창에서 ‘PDF로 저장’을 선택하면 PDF 파일로 받을 수 있습니다.</Text>
        {!report.isTemplate && <Text size="sm" color="inherit">산출 중이거나 산출할 수 없는 지표도 현재 상태와 사유를 포함해 출력합니다.</Text>}
        {hasReference && <CheckboxInput label="월별 금액 참고자료를 PDF에 포함" value={includeReferenceInPrint}
          onChange={setIncludeReferenceInPrint} description="기본 3쪽 · 선택 시 참고자료를 포함한 4쪽" />}
      </VStack>

      <Sheet page={1}>
        <VStack as="header" gap={2}>
          <VStack paddingBlock={3} className="border-y-4! border-solid border-report-blue!">
            <Heading level={1} color="inherit" justify="center" className="text-2xl">{report.title}</Heading>
          </VStack>
          <Text size="sm" color="inherit" justify="end">({report.generatedOn}, 자금기획팀)</Text>
          <Text size="xsm" color="inherit" justify="end">보고 기준: {report.reportMonth} · 최신 회차: {report.latestRound}</Text>
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
          {report.isTemplate && <Text size="xsm" color="inherit">양식 미리보기: 파일을 업로드하고 산출하면 실제 결과가 반영됩니다.</Text>}
          {report.warnings.length > 0 && (
            <VStack gap={1}>
              {report.warnings.map((warning, index) => <Text key={index} size="xsm" color="inherit">※ {warning}</Text>)}
            </VStack>
          )}
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

      <ReferencePage last={!hasReference || !includeReferenceInPrint} />
      {report.referenceTrends !== null && <StatementReferencePage trend={report.referenceTrends} />}
    </VStack>
  );
}
