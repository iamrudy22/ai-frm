'use client';

/**
 * 건설경기 인식 지수 카드 — 표시만 한다(구현 계획 §11).
 *
 * 흐름 조율은 서버의 유스케이스가 맡는다. 이 카드는
 *   1. 최신 회차가 읽혔으면 기재분(실적 1개, 계획 3개)만 떼어 POST하고
 *   2. GET으로 기준월 한 달의 결과를 받아 그린다.
 * 회차를 올리지 않아도 이력은 서버에 있으므로 2만으로 결과가 나온다.
 *
 * 서버 전용 모듈(ECOS, 이력 파일)을 import하지 않는다(경계 규칙 6). 인증키와
 * 이력 파일은 브라우저로 오지 않는다. 자금수지표 원본도 서버로 가지 않는다.
 */

import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import type { PerceptionReportDto, PerceptionResponse, RecordRoundResponse } from '@/app/api/construction-perception/dto';
import {
  baseMonthNote,
  indicatorRows,
  ledgerNote,
  missingRows,
} from '@/app/aifrm/construction-perception-view';
import { GRADE_BADGE } from '@/app/aifrm/format';
import { roundEntryOf } from '@/domain/cashflow/round-entry';
import type { Statement } from '@/domain/cashflow/statement';
import { commentFor } from '@/domain/risk/construction-perception/policy';

const INDICATOR_COLUMNS = [
  { key: '지표', header: '지표' },
  { key: '원값', header: '당월 원값' },
  { key: '변화율', header: '변화율' },
  { key: '점수', header: '점수' },
  { key: '기여도', header: '기여도' },
];

const MISSING_COLUMNS = [
  { key: '지표', header: '지표' },
  { key: '사유', header: '사유' },
];

type RecordNote = { readonly status: 'success' | 'warning'; readonly text: string };

type Loaded = {
  /** 이 결과가 어느 회차 업로드에 대한 것인가. 다르면 아직 불러오는 중이다. */
  readonly for: Statement | null;
  readonly response: PerceptionResponse;
  readonly recordNote: RecordNote | null;
};

export function ConstructionPerceptionCard({ latest }: { latest: Statement | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const recordNote = latest === null ? null : await recordLatestRound(latest);
      const response = await fetchPerception();
      if (!cancelled) setLoaded({ for: latest, response, recordNote });
    })();
    return () => {
      cancelled = true;
    };
  }, [latest]);

  const isLoading = loaded === null || loaded.for !== latest;

  return (
    <VStack gap={3}>
      <Heading level={2}>건설경기 인식 지수</Heading>
      {loaded === null ? (
        <Text type="supporting">한국은행 ECOS에서 지표를 불러오는 중…</Text>
      ) : (
        <>
          {isLoading && <Text type="supporting">최신 회차를 반영하고 다시 불러오는 중…</Text>}
          {loaded.recordNote !== null && (
            <Banner
              status={loaded.recordNote.status}
              title={loaded.recordNote.status === 'success' ? '회차를 이력에 반영했습니다' : '회차를 이력에 반영하지 못했습니다'}
              description={loaded.recordNote.text}
              isDismissable={loaded.recordNote.status === 'success'}
            />
          )}
          {loaded.response.ok ? (
            <PerceptionResult report={loaded.response.value} />
          ) : (
            <Banner status="error" title="산출할 수 없습니다" description={loaded.response.reason} />
          )}
        </>
      )}
    </VStack>
  );
}

function PerceptionResult({ report }: { report: PerceptionReportDto }) {
  const { result, diagnostics } = report;
  const fetchedAt = new Date(diagnostics.fetchedAt).toLocaleString('ko-KR');
  const note = baseMonthNote(report);

  return (
    <VStack gap={3} align="start">
      <Text type="supporting">
        기준월 {result.month ?? '미정'} · ECOS 조회 {fetchedAt}
      </Text>

      {result.kind === 'ok' ? (
        <>
          <HStack gap={2} vAlign="center">
            <Badge variant={GRADE_BADGE[result.grade]} label={result.grade} />
            <Text>종합위기인식지수 {result.index.toFixed(2)}</Text>
          </HStack>
          <Text type="supporting">{commentFor(result.grade)}</Text>
          {/* 표가 부모의 첫·마지막 자식이면 Astryx가 위아래로 번지게 그린다. 설명을 앞뒤에 둔다. */}
          <Collapsible trigger="지표별 산출 내역" defaultIsOpen>
            <VStack gap={2}>
              <Text type="supporting" size="xsm">
                변화율을 0~1 점수로 바꾸고 가중치를 곱해 더한 값이 종합위기인식지수입니다.
              </Text>
              <Table data={indicatorRows(report)} columns={INDICATOR_COLUMNS} />
              <Text type="supporting" size="xsm">
                원값의 단위는 ECOS 응답 그대로입니다. 대출금리 변화율은 bp(%p × 100)입니다. 분양회수
                예측오차는 원값이 아니라 이력에서 계산한 3개월 누적 오차율입니다.
              </Text>
            </VStack>
          </Collapsible>
        </>
      ) : (
        <Banner
          status="warning"
          title="산출불가"
          description={`${result.missing.length}개 지표의 값이 없어 종합위기인식지수와 종합위기단계를 내지 않았습니다. 빈 값을 0으로 세지 않습니다.`}
          collapsible={false}
        >
          <Table data={missingRows(result)} columns={MISSING_COLUMNS} />
        </Banner>
      )}

      <VStack gap={1}>
        {note !== null && (
          <Text type="supporting" size="xsm">
            {note}
          </Text>
        )}
        <Text type="supporting" size="xsm">
          {ledgerNote(diagnostics.ledger)}
        </Text>
        <Text type="supporting" size="xsm">
          종합위기단계: 20 미만 정상 · 40 미만 주의 · 60 미만 경고 · 60 이상 위기. 기준월은 자금수지표
          기준월과 별개로, 10종이 모두 나온 가장 최근 달로 자동으로 정해집니다.
        </Text>
      </VStack>
    </VStack>
  );
}

async function fetchPerception(): Promise<PerceptionResponse> {
  try {
    const res = await fetch('/api/construction-perception', { cache: 'no-store' });
    return (await res.json()) as PerceptionResponse;
  } catch {
    return { ok: false, reason: '서버에 연결하지 못했습니다.' };
  }
}

/** 최신 회차에서 기재분을 떼어 이력에 반영한다. 실패해도 결과 조회는 이어 간다. */
async function recordLatestRound(latest: Statement): Promise<RecordNote> {
  let entry;
  try {
    entry = roundEntryOf(latest);
  } catch (e) {
    return { status: 'warning', text: `회차에서 분양회수를 뗄 수 없습니다 — ${e instanceof Error ? e.message : e}` };
  }

  try {
    const res = await fetch('/api/forecast-ledger/rounds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    });
    const out = (await res.json()) as RecordRoundResponse;
    if (!out.ok) return { status: 'warning', text: out.reason };
  } catch {
    return { status: 'warning', text: '서버에 연결하지 못했습니다.' };
  }

  const actual = 'value' in entry.actual ? `${entry.actual.month} 실적` : null;
  const parts = [actual, `${entry.plan.month}부터 3개월 계획`].filter((x) => x !== null).join('과 ');
  const caveat = 'missing' in entry.actual ? ` ${entry.actual.missing}` : '';
  return { status: 'success', text: `${entry.round} 회차의 ${parts}을 반영했습니다.${caveat}` };
}
