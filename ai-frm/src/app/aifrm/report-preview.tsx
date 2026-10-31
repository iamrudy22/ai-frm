'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { VStack } from '@astryxdesign/core/VStack';

import { ReportChart } from './report-chart';
import type { FinancialReport, ReportMetric } from './report-model';
import referenceRiskCriteria from './assets/reference-risk-criteria.png';
import referenceLcrFormula from './assets/reference-lcr-formula.png';

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
        <Heading level={3} color="inherit" className="text-base report-metric-label">○ {metric.title}</Heading>
        <Text type="label" color="inherit" hasTabularNumbers className="report-metric-label">{metric.value}</Text>
        <Text type="label" color="inherit" className={`report-metric-label ${statusClass(metric)}`}>[{metric.status}]</Text>
      </HStack>
      <Text size="sm" color="inherit" className={hasFailure ? 'report-narrative report-screen-details' : 'report-narrative'}>- {metric.narrative}</Text>
      {hasFailure && <Text size="sm" color="inherit" className="report-narrative report-print-summary">- {shortReason(metric.narrative)}</Text>}
      {metric.id === 'construction' && <Text size="xsm" color="inherit" className="report-note">기준: {metric.basis}</Text>}
      <Text size="xsm" color="inherit" className="report-note">* {metric.formula}</Text>
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
      <VStack gap={3} className="break-inside-avoid">
        <Heading level={2} color="inherit" className="text-lg">□ 위험단계 기준</Heading>
        <Image src={referenceRiskCriteria} width={1350} height={1332}
          alt="골든셋 원본 위험단계 기준표: 내부·외부 관리지표와 산식, 구성 가중치, 정상·주의·경고·위기 기준"
          aria-describedby="reference-risk-criteria-description"
          unoptimized loading="eager" className="h-auto w-full" />
        <VisuallyHidden as="div" id="reference-risk-criteria-description">
          관리지표 및 산식. 위험단계: 정상(G), 주의(Y), 경고(O), 위기(R).
          내부지표. [대금회수위험] = 매월 실제 대금회수금액 / 매월 대금회수 계획금액(자금계획).
          정상(G) 90%이상, 주의(Y) 90%미만 80%이상, 경고(O) 80%미만 70%이상, 위기(R) 70%미만.
          [유동성위험] = 매월 기초시재 / 향후 3개월 순지출 계획금액.
          정상(G) 50%이상, 주의(Y) 50%미만 25%이상, 경고(O) 25%미만 15%이상, 위기(R) 15%미만.
          외부지표. [건설경기인식지수].
          - 국내건설수주액(11), - 주택매매가격지수(23), - 미분양주택현황(4), - 주택건설인허가실적(31), - 설비투자지수(14),
          - 직전3개월 분양회수예측오차(3), - 대출금리(2), - KOSPI지수(5), - 원/달러환율(5), - 선행지수순환변동치(3).
          ※ ( ) 괄호 안 : 가중치.
          정상(G) 20미만, 주의(Y) 20이상 40미만, 경고(O) 40이상 60미만, 위기(R) 60이상.
          [조달위기지수] = 1년만기 공사AAA채권과 국고채의 금리 차이.
          정상(G) 0.24%미만, 주의(Y) 0.24%이상 0.52%미만, 경고(O) 0.52%이상 0.79%미만, 위기(R) 0.79%이상.
        </VisuallyHidden>
      </VStack>
      <VStack gap={3} className="break-inside-avoid">
        <Heading level={2} color="inherit" className="text-lg">□ 적정시재 산정방식 (LCR 방식)</Heading>
        <Image src={referenceLcrFormula} width={1350} height={156}
          alt="골든셋 원본 적정시재 산정방식(LCR 방식) 표"
          aria-describedby="reference-lcr-formula-description"
          unoptimized loading="eager" className="h-auto w-full" />
        <VisuallyHidden as="div" id="reference-lcr-formula-description">
          적정시재 = (향후 3개월) 분양회수예정액 X 20% + 기타회수예정액 X 10% + 사업비지출계획 X 10% + 순지출계획 X 40%
        </VisuallyHidden>
      </VStack>
    </Sheet>
  );
}

export function FinancialReportPreview({ report, onBack, onDownloadHwpx, isDownloadingHwpx = false, hwpxDownloadError = null }: {
  report: FinancialReport; onBack?: () => void; onDownloadHwpx?: () => void;
  isDownloadingHwpx?: boolean; hwpxDownloadError?: string | null;
}) {
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
            {onDownloadHwpx && <Button label="한글(HWPX) 다운로드" variant="secondary" size="sm"
              isLoading={isDownloadingHwpx} isDisabled={isDownloadingHwpx} onClick={onDownloadHwpx} />}
            <Button label="인쇄 / PDF 저장" variant="primary" size="sm" onClick={() => window.print()} />
          </HStack>
        </HStack>
        {onDownloadHwpx && hwpxDownloadError && <Text size="sm" color="inherit" role="status" aria-live="polite">{hwpxDownloadError}</Text>}
      </VStack>
      <Sheet page={1}>
        <VStack as="header" gap={2}>
          <VStack paddingBlock={3} className="border-y-4! border-solid border-report-blue!">
            <Heading level={1} color="inherit" justify="center" className="text-2xl">{report.title}</Heading>
          </VStack>
          <Text size="sm" color="inherit" justify="end" className="report-date">({report.generatedOn}, 자금기획팀)</Text>
        </VStack>

        <VStack gap={3}>
          <Heading level={2} color="inherit" className="text-lg">□ 재무위험지수 종합</Heading>
          <HStack gap={3} padding={3} wrap="wrap" className="bg-report-summary border! border-solid border-report-ink/30!">
            {report.metrics.map((item) => (
              <HStack gap={1} key={item.id} vAlign="center" wrap="wrap">
                <Text type="label" color="inherit" size="sm" className="report-summary-label">◇ {item.title}</Text>
                <Text type="label" color="inherit" size="sm" className={`report-summary-label ${statusClass(item)}`}>({item.status})</Text>
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
