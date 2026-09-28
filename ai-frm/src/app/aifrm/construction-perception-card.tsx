'use client';

/**
 * 건설경기 인식 지수 카드 — 표시만 한다(구현 계획 §11).
 *
 * 흐름 조율은 서버의 유스케이스가 맡는다. 이 카드는
 *   1. 최신 회차가 새로 읽혔으면 기재분(실적 1개, 계획 3개)만 떼어 한 번 POST하고
 *   2. GET으로 기준월 한 달의 결과를 받아 그린다.
 *
 * 기준월(정책 §5, 2026-09-28 개정): 사용자가 고른 달 > 최신 회차 기준월 − 2 >
 * 오늘 − 2. 서버가 정한다. 카드는 보고월(회차)과 사용자가 고른 달만 보낸다.
 * 고른 달은 그것을 고를 때의 회차에 묶여 있어서, 회차를 새로 올리면 저절로
 * 기본값으로 돌아간다.
 *
 * 서버 전용 모듈(ECOS, 이력 파일)을 import하지 않는다(경계 규칙 6).
 */

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import type { PerceptionReportDto, PerceptionResponse, RecordRoundResponse } from '@/app/api/construction-perception/dto';
import {
  basisNote,
  indicatorRows,
  ledgerNote,
  missingRows,
  monthOptions,
  revisionNote,
} from '@/app/aifrm/construction-perception-view';
import { GRADE_BADGE } from '@/app/aifrm/format';
import { roundEntryOf } from '@/domain/cashflow/round-entry';
import { calendarOf, type Statement } from '@/domain/cashflow/statement';
import { commentFor } from '@/domain/risk/construction-perception/policy';
import { parseYearMonth, type YearMonth } from '@/domain/shared/year-month';

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

/** 사용자가 고른 기준월. 고를 때의 회차에 묶인다. */
type Choice = { readonly for: Statement | null; readonly month: YearMonth };

type Loaded = {
  /** 이 결과가 어느 회차·선택에 대한 것인가. 다르면 아직 불러오는 중이다. */
  readonly latest: Statement | null;
  readonly chosen: YearMonth | undefined;
  readonly response: PerceptionResponse;
  readonly recordNote: RecordNote | null;
};

/**
 * isReading: 페이지가 회차 파일을 읽는 동안에는 이전 회차를 잠시 비운다. 그 사이
 * 회차 없는 요청을 보내 화면이 깜빡이지 않도록, 읽는 동안에는 부르지 않는다.
 */
export function ConstructionPerceptionCard({ latest, isReading = false }: { latest: Statement | null; isReading?: boolean }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // 회차마다 POST는 한 번만. 기준월만 바꿀 때는 GET만 다시 부른다.
  const recorded = useRef<{ for: Statement | null; note: Promise<RecordNote | null> } | null>(null);

  const chosen = choice !== null && choice.for === latest ? choice.month : undefined;
  const reportMonth = latest === null ? undefined : calendarOf(latest, latest.defaultBaseMonth);

  useEffect(() => {
    if (isReading) return;
    let cancelled = false;
    if (recorded.current === null || recorded.current.for !== latest) {
      recorded.current = { for: latest, note: latest === null ? Promise.resolve(null) : recordLatestRound(latest) };
    }
    const noteFor = recorded.current.note;
    (async () => {
      const recordNote = await noteFor;
      const response = await fetchPerception(reportMonth, chosen);
      if (!cancelled) setLoaded({ latest, chosen, response, recordNote });
    })();
    return () => {
      cancelled = true;
    };
  }, [latest, chosen, reportMonth, isReading]);

  const isLoading = isReading || loaded === null || loaded.latest !== latest || loaded.chosen !== chosen;

  return (
    <VStack gap={3}>
      <Heading level={2}>건설경기 인식 지수</Heading>
      {loaded === null ? (
        <Text type="supporting">한국은행 ECOS에서 지표를 불러오는 중…</Text>
      ) : (
        <>
          {loaded.recordNote !== null && (
            <Banner
              status={loaded.recordNote.status}
              title={loaded.recordNote.status === 'success' ? '회차를 이력에 반영했습니다' : '회차를 이력에 반영하지 못했습니다'}
              description={loaded.recordNote.text}
              isDismissable={loaded.recordNote.status === 'success'}
            />
          )}
          {loaded.response.ok ? (
            <PerceptionResult
              report={loaded.response.value}
              isLoading={isLoading}
              onChoose={(month) => setChoice({ for: latest, month })}
              onReset={() => setChoice(null)}
            />
          ) : (
            <Banner status="error" title="산출할 수 없습니다" description={loaded.response.reason} />
          )}
        </>
      )}
    </VStack>
  );
}

function PerceptionResult({
  report,
  isLoading,
  onChoose,
  onReset,
}: {
  report: PerceptionReportDto;
  isLoading: boolean;
  onChoose: (month: YearMonth) => void;
  onReset: () => void;
}) {
  const { basis, result, diagnostics } = report;
  const fetchedAt = new Date(diagnostics.fetchedAt).toLocaleString('ko-KR');
  const revision = revisionNote(report);

  return (
    <VStack gap={3} align="start">
      <HStack gap={2} vAlign="end">
        <Selector
          label="기준월"
          description="기본값은 보고월 − 2개월입니다"
          options={monthOptions(report.selectable, basis.baseMonth)}
          value={basis.baseMonth}
          onChange={(value) => onChoose(parseYearMonth(value))}
          isDisabled={isLoading}
        />
        {basis.source === '선택' && <Button label="기본값으로" variant="secondary" onClick={onReset} />}
      </HStack>
      <Text type="supporting">
        {basisNote(basis)} · ECOS 조회 {fetchedAt}
        {isLoading ? ' · 다시 불러오는 중…' : ''}
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
          title={`산출불가 — ${result.month}`}
          description={`${result.missing.length}개 지표의 값이 없어 종합위기인식지수와 종합위기단계를 내지 않았습니다. 빈 값을 0으로 세지 않고, 이전 달로 옮겨 가지도 않습니다.`}
          collapsible={false}
        >
          <Table data={missingRows(result)} columns={MISSING_COLUMNS} />
        </Banner>
      )}

      <VStack gap={1}>
        {revision !== null && (
          <Text type="supporting" size="xsm">
            {revision}
          </Text>
        )}
        <Text type="supporting" size="xsm">
          {ledgerNote(diagnostics.ledger)}
        </Text>
        <Text type="supporting" size="xsm">
          종합위기단계: 20 미만 정상 · 40 미만 주의 · 60 미만 경고 · 60 이상 위기. 기준월은 최신 회차(없으면
          오늘)의 달에서 2개월 전이며, 자금수지표 기준월 선택과는 따로 움직입니다.
        </Text>
      </VStack>
    </VStack>
  );
}

async function fetchPerception(reportMonth?: YearMonth, baseMonth?: YearMonth): Promise<PerceptionResponse> {
  const params = new URLSearchParams();
  if (reportMonth !== undefined) params.set('reportMonth', reportMonth);
  if (baseMonth !== undefined) params.set('baseMonth', baseMonth);
  const query = params.size > 0 ? `?${params}` : '';
  try {
    const res = await fetch(`/api/construction-perception${query}`, { cache: 'no-store' });
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
