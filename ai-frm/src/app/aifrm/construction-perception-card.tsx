'use client';

/**
 * 건설경기 인식 지수 — 조회 훅과 표시 카드(구현 계획 §11).
 *
 * 흐름 조율은 서버의 유스케이스가 맡는다. usePerception은 페이지가 읽어 둔 회차들에서
 * 분양회수 기재분만 떼어 기준월과 함께 POST로 보내고 결과를 들고 있는다. 페이지는
 * 그 결과를 위쪽 요약과 이 카드에 함께 쓴다. 카드는 그리기만 한다.
 *
 * 회차는 저장하지 않는다(2026-09-28). 올린 회차만으로 매번 계산한다.
 * 분양회수 예측오차(기준월 b)에는 b−1월 회차(계획)와 b+2월 회차(실적)가 필요하다.
 *
 * 기준월(정책 §5, 2026-09-28 결정): 사용자가 고른 달 > 최신 회차 − 2.
 * 서버가 정한다. 훅은 보고월(최신 회차)과 사용자가 고른 달만 보낸다. 고른 달은
 * 그때의 회차 묶음에 묶여 있어서, 회차를 새로 읽으면 기본값으로 돌아간다.
 *
 * 서버 전용 모듈(ECOS)을 import하지 않는다(경계 규칙 6).
 */

import { useEffect, useMemo, useState } from 'react';
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

import type { PerceptionReportDto, PerceptionResponse } from '@/app/api/construction-perception/dto';
import {
  basisNote,
  type BatchResult,
  forecastWindowNote,
  indicatorRows,
  ledgerNote,
  missingRows,
  monthOptions,
  readRoundsText,
  revisionNote,
} from '@/app/aifrm/construction-perception-view';
import type { NamedStatement } from '@/app/aifrm/uploaded-rounds';
import { GRADE_BADGE } from '@/app/aifrm/format';
import { roundEntryOf, type RoundEntry } from '@/domain/cashflow/round-entry';
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

export type Perception = {
  /** 이 회차 묶음의 결과. 아직 한 번도 받지 못했으면 null. */
  readonly response: PerceptionResponse | null;
  /** 기준월을 바꿔 다시 받는 중. response는 앞선 결과다. */
  readonly isLoading: boolean;
  /** 분양회수를 떼지 못한 회차. */
  readonly unreadable: { readonly text: string } | null;
  readonly choose: (month: YearMonth) => void;
  readonly reset: () => void;
};

type Choice = { readonly for: readonly NamedStatement[]; readonly month: YearMonth };

type Loaded = {
  /** 어느 회차 묶음·선택에 대한 결과인가. 다르면 아직 불러오는 중이다. */
  readonly for: readonly NamedStatement[];
  readonly chosen: YearMonth | undefined;
  readonly response: PerceptionResponse;
};

/** named가 null이면(아직 산출 전) 부르지 않는다. */
export function usePerception(latest: Statement | null, named: readonly NamedStatement[] | null): Perception {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const chosen = named !== null && choice?.for === named ? choice.month : undefined;
  const reportMonth = latest === null ? undefined : calendarOf(latest, latest.defaultBaseMonth);

  // 회차마다 분양회수 기재분을 뗀다. 못 뗀 회차는 알리고 빼고 보낸다.
  const { rounds, unreadable } = useMemo(() => {
    const entries: RoundEntry[] = [];
    const failures: BatchResult[] = [];
    for (const { file, statement } of named ?? []) {
      try {
        entries.push(roundEntryOf(statement));
      } catch (e) {
        failures.push({ file, reason: `분양회수를 뗄 수 없습니다 — ${e instanceof Error ? e.message : e}` });
      }
    }
    return { rounds: entries, unreadable: failures.length === 0 ? null : readRoundsText(failures) };
  }, [named]);

  useEffect(() => {
    if (named === null) return;
    let cancelled = false;
    (async () => {
      const response = await fetchPerception(rounds, reportMonth, chosen);
      if (!cancelled) setLoaded({ for: named, chosen, response });
    })();
    return () => {
      cancelled = true;
    };
  }, [named, rounds, chosen, reportMonth]);

  const current = named !== null && loaded?.for === named ? loaded : null;
  return {
    response: current?.response ?? null,
    isLoading: current === null || current.chosen !== chosen,
    unreadable,
    choose: (month) => {
      if (named !== null) setChoice({ for: named, month });
    },
    reset: () => setChoice(null),
  };
}

export function ConstructionPerceptionCard({ perception }: { perception: Perception }) {
  const { response, isLoading, unreadable, choose, reset } = perception;
  return (
    <VStack gap={3}>
      <Heading level={2}>건설경기 인식 지수</Heading>
      {unreadable !== null && (
        <Banner status="warning" title="분양회수를 읽지 못한 회차가 있습니다" description={unreadable.text} />
      )}
      {response === null ? (
        <Text type="supporting">한국은행 ECOS에서 지표를 불러오는 중…</Text>
      ) : response.ok ? (
        <PerceptionResult report={response.value} isLoading={isLoading} onChoose={choose} onReset={reset} />
      ) : (
        <Banner status="error" title="산출할 수 없습니다" description={response.reason} />
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
          label="건설경기 기준월"
          description="기본값은 최신 회차 − 2개월입니다(8월 기준이면 6월)"
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
                원값의 단위는 ECOS 응답 그대로입니다. 대출금리 변화율은 bp(%p × 100)입니다.{' '}
                {forecastWindowNote(result.month)}
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
          {ledgerNote(diagnostics.ledger, basis.baseMonth)}
        </Text>
        <Text type="supporting" size="xsm">
          종합위기단계: 20 미만 정상 · 40 미만 주의 · 60 미만 경고 · 60 이상 위기. 건설경기 기준월은
          Gap·시재 기준월과 따로 움직입니다.
        </Text>
      </VStack>
    </VStack>
  );
}

async function fetchPerception(
  rounds: readonly RoundEntry[],
  reportMonth?: YearMonth,
  baseMonth?: YearMonth,
): Promise<PerceptionResponse> {
  try {
    const res = await fetch('/api/construction-perception', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rounds, reportMonth, baseMonth }),
      cache: 'no-store',
    });
    return (await res.json()) as PerceptionResponse;
  } catch {
    return { ok: false, reason: '서버에 연결하지 못했습니다.' };
  }
}
