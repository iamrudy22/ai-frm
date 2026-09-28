'use client';

/**
 * 조달위험 인식 지수 — 조회 훅과 표시 카드.
 *
 * 흐름 조율은 서버의 유스케이스가 맡는다. useFundingRisk는 판단월(최신 회차의 달)을
 * POST로 보내고 결과를 들고 있는다. 페이지는 그 결과를 위쪽 요약과 이 카드에 함께 쓴다.
 * 카드는 그리기만 한다.
 *
 * 금리는 서버가 금융투자협회 채권정보센터에서 불러온다. 채권정보센터는 CORS 헤더가
 * 없어 브라우저가 직접 부를 수 없다. 서버 전용 모듈을 import하지 않는다(경계 규칙 6).
 */

import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { proportional, Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import type { FundingRiskReportDto, FundingRiskResponse } from '@/app/api/funding-risk/dto';
import { basisText, canRetry, evaluationNote, yieldRows } from '@/app/aifrm/funding-risk-view';
import { GRADE_BADGE, percentPoints } from '@/app/aifrm/format';
import { AGENCIES } from '@/domain/risk/funding-risk/funding-risk';
import { commentFor } from '@/domain/risk/funding-risk/policy';
import type { YearMonth } from '@/domain/shared/year-month';

const YIELD_COLUMNS = [
  { key: '채권', header: '채권 (잔존 1년)', width: proportional(2) },
  ...AGENCIES.map((agency) => ({ key: agency, header: agency, width: proportional(1), align: 'end' as const })),
  { key: '3사 평균', header: '3사 평균', width: proportional(1), align: 'end' as const },
];

export type FundingRiskState = {
  /** 이 판단월의 결과. 아직 받지 못했으면 null. */
  readonly response: FundingRiskResponse | null;
  readonly retry: () => void;
};

type Loaded = { readonly judged: YearMonth; readonly attempt: number; readonly response: FundingRiskResponse };

/** judged가 null이면(아직 산출 전) 부르지 않는다. */
export function useFundingRisk(judged: YearMonth | null): FundingRiskState {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (judged === null) return;
    let cancelled = false;
    (async () => {
      const response = await fetchFundingRisk(judged);
      if (!cancelled) setLoaded({ judged, attempt, response });
    })();
    return () => {
      cancelled = true;
    };
  }, [judged, attempt]);

  const current = loaded !== null && loaded.judged === judged && loaded.attempt === attempt ? loaded : null;
  return { response: current?.response ?? null, retry: () => setAttempt((n) => n + 1) };
}

export function FundingRiskCard({ fundingRisk }: { fundingRisk: FundingRiskState }) {
  const { response, retry } = fundingRisk;
  return (
    <VStack gap={3}>
      <Heading level={2}>조달위험 인식 지수</Heading>
      {response === null ? (
        <Text type="supporting">금융투자협회 채권정보센터에서 금리를 불러오는 중…</Text>
      ) : response.ok ? (
        <FundingRiskResult report={response.value} onRetry={canRetry(response) ? retry : null} />
      ) : (
        <VStack gap={2} align="start">
          <Banner status="error" title="산출할 수 없습니다" description={response.reason} />
          <Button label="다시 불러오기" variant="secondary" onClick={retry} />
        </VStack>
      )}
    </VStack>
  );
}

function FundingRiskResult({ report, onRetry }: { report: FundingRiskReportDto; onRetry: (() => void) | null }) {
  const { result, fetchedAt } = report;
  const fetched = fetchedAt === null ? '' : ` · 채권정보센터 조회 ${new Date(fetchedAt).toLocaleString('ko-KR')}`;

  return (
    <VStack gap={3} align="start">
      <Text type="supporting">
        {basisText(report)}
        {fetched}
      </Text>

      {result.kind === 'ok' ? (
        <>
          <HStack gap={2} vAlign="center">
            <Badge variant={GRADE_BADGE[result.grade]} label={result.grade} />
            <Text>금리 차이 {percentPoints(result.spread)}</Text>
          </HStack>
          <Text type="supporting">{commentFor(result.grade)}</Text>
          {/* 표가 부모의 첫·마지막 자식이면 Astryx가 위아래로 번지게 그린다. 설명을 앞뒤에 둔다. */}
          <Collapsible trigger="평가사별 금리" defaultIsOpen>
            <VStack gap={2}>
              <Text type="supporting" size="xsm">
                {result.evaluationDate} 평가일, 단위 %.
              </Text>
              <Table data={yieldRows(result)} columns={YIELD_COLUMNS} />
              <Text type="supporting" size="xsm">
                3사 평균은 채권정보센터가 낸 값 그대로입니다(셋째 자리 아래를 버림). 금리 차이는 두 3사 평균의
                차이입니다.
              </Text>
            </VStack>
          </Collapsible>
        </>
      ) : (
        <Banner
          status="warning"
          title={`산출불가 — 판단월 ${result.judgedMonth}`}
          description={`${result.reason} 빈 값을 0으로 세지 않고, 그 전 평가일로 옮겨 가지도 않습니다.`}
        />
      )}

      {onRetry !== null && <Button label="다시 불러오기" variant="secondary" onClick={onRetry} />}

      <VStack gap={1}>
        {result.kind === 'ok' && evaluationNote(result) !== null && (
          <Text type="supporting" size="xsm">
            {evaluationNote(result)}
          </Text>
        )}
        <Text type="supporting" size="xsm">
          금리 차이 = 특수채/공사채 및 공단채/AAA − 국채/국고채권/양곡,외평,재정. 둘 다 잔존 1년,
          나이스피앤아이·한국자산평가·KIS자산평가 3사 평균이고, 판단월 전달의 마지막 평가일 값입니다.
        </Text>
        <Text type="supporting" size="xsm">
          0.24%p 미만 정상 · 0.52%p 미만 주의 · 0.79%p 미만 경고 · 0.79%p 이상 위기.
        </Text>
      </VStack>
    </VStack>
  );
}

async function fetchFundingRisk(judgedMonth: YearMonth): Promise<FundingRiskResponse> {
  try {
    const res = await fetch('/api/funding-risk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ judgedMonth }),
      cache: 'no-store',
    });
    return (await res.json()) as FundingRiskResponse;
  } catch {
    return { ok: false, reason: '서버에 연결하지 못했습니다.' };
  }
}
