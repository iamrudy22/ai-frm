'use client';

/**
 * 건설경기 인식 지수 카드 — 표시만 한다(구현 계획 §11).
 *
 * 흐름 조율은 서버의 유스케이스가 맡는다. 이 카드는 올린 회차들에서 분양회수
 * 기재분만 떼어 기준월과 함께 POST로 보내고, 받은 결과를 그린다.
 *
 * 회차는 저장하지 않는다(2026-09-28). 화면에 올린 회차 — 위의 이전·최신 회차와
 * 이 카드에서 더 올린 회차 — 만으로 매번 계산한다. 새로고침하면 다시 올린다.
 * 분양회수 예측오차(기준월 t)에는 t−3 ~ t월 회차 네 개가 필요하다.
 *
 * 기준월(정책 §5, 2026-09-28 개정): 사용자가 고른 달 > 최신 회차 기준월 − 2 >
 * 오늘 − 2. 서버가 정한다. 카드는 보고월(회차)과 사용자가 고른 달만 보낸다.
 * 고른 달은 그것을 고를 때의 회차에 묶여 있어서, 회차를 새로 올리면 저절로
 * 기본값으로 돌아간다.
 *
 * 서버 전용 모듈(ECOS)을 import하지 않는다(경계 규칙 6).
 */

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { FileInput } from '@astryxdesign/core/FileInput';
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
  indicatorRows,
  ledgerNote,
  missingRows,
  monthOptions,
  readRoundsText,
  revisionNote,
} from '@/app/aifrm/construction-perception-view';
import { GRADE_BADGE } from '@/app/aifrm/format';
import { roundEntryOf, type RoundEntry } from '@/domain/cashflow/round-entry';
import { calendarOf, type Statement } from '@/domain/cashflow/statement';
import { commentFor } from '@/domain/risk/construction-perception/policy';
import { readStatement } from '@/infrastructure/xlsx/statement-reader';
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

type ReadNote = { readonly status: 'success' | 'warning'; readonly text: string };

/** 사용자가 고른 기준월. 고를 때의 회차에 묶인다. */
type Choice = { readonly for: Statement | null; readonly month: YearMonth };

type Loaded = {
  /** 이 결과가 어느 회차 묶음·선택에 대한 것인가. 다르면 아직 불러오는 중이다. */
  readonly rounds: readonly RoundEntry[];
  readonly chosen: YearMonth | undefined;
  readonly response: PerceptionResponse;
};

/**
 * isReading: 페이지가 회차 파일을 읽는 동안에는 이전 회차를 잠시 비운다. 그 사이
 * 회차 없는 요청을 보내 화면이 깜빡이지 않도록, 읽는 동안에는 부르지 않는다.
 */
export function ConstructionPerceptionCard({
  latest,
  previous = null,
  isReading = false,
}: {
  latest: Statement | null;
  previous?: Statement | null;
  isReading?: boolean;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // 이 카드에서 더 올린 회차. 서버에 남기지 않는다.
  const [uploaded, setUploaded] = useState<readonly RoundEntry[]>([]);
  const [pickedFiles, setPickedFiles] = useState<File[]>([]);
  const [readNote, setReadNote] = useState<ReadNote | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const chosen = choice !== null && choice.for === latest ? choice.month : undefined;
  const reportMonth = latest === null ? undefined : calendarOf(latest, latest.defaultBaseMonth);

  // 위의 이전·최신 회차와 이 카드에서 올린 회차를 합친다. 같은 회차면 나중 것이 이긴다.
  const { rounds, pageNote } = useMemo(() => {
    const byRound = new Map<YearMonth, RoundEntry>();
    const failures: BatchResult[] = [];
    const fromPage = [
      { file: '이전 회차', statement: previous },
      { file: '최신 회차', statement: latest },
    ];
    for (const { file, statement } of fromPage) {
      if (statement === null) continue;
      const entry = entryOf(file, statement);
      if ('reason' in entry) failures.push(entry);
      else byRound.set(entry.round, entry);
    }
    for (const entry of uploaded) byRound.set(entry.round, entry);
    return { rounds: [...byRound.values()], pageNote: failures.length === 0 ? null : readRoundsText(failures) };
  }, [previous, latest, uploaded]);

  useEffect(() => {
    if (isReading) return;
    let cancelled = false;
    (async () => {
      const response = await fetchPerception(rounds, reportMonth, chosen);
      if (!cancelled) setLoaded({ rounds, chosen, response });
    })();
    return () => {
      cancelled = true;
    };
  }, [rounds, chosen, reportMonth, isReading]);

  const addRounds = async (files: File[]) => {
    setIsAdding(true);
    const added: RoundEntry[] = [];
    const results: BatchResult[] = [];
    for (const file of files) {
      const read = readStatement(await file.arrayBuffer());
      const entry = read.ok ? entryOf(file.name, read.statement) : { file: file.name, reason: read.error };
      if ('reason' in entry) {
        results.push(entry);
      } else {
        added.push(entry);
        results.push({ file: file.name, round: entry.round });
      }
    }
    setUploaded((prev) => [...prev, ...added]);
    setReadNote(readRoundsText(results));
    setPickedFiles([]);
    setIsAdding(false);
  };

  const isLoading = isReading || loaded === null || loaded.rounds !== rounds || loaded.chosen !== chosen;

  return (
    <VStack gap={3}>
      <Heading level={2}>건설경기 인식 지수</Heading>
      {loaded === null ? (
        <Text type="supporting">한국은행 ECOS에서 지표를 불러오는 중…</Text>
      ) : (
        <>
          {pageNote !== null && (
            <Banner status="warning" title="위에서 올린 회차의 분양회수를 읽지 못했습니다" description={pageNote.text} />
          )}
          {readNote !== null && (
            <Banner
              status={readNote.status}
              title={readNote.status === 'success' ? '회차를 읽었습니다' : '회차 일부를 읽지 못했습니다'}
              description={readNote.text}
              isDismissable
              onDismiss={() => setReadNote(null)}
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
          <HStack gap={2} vAlign="end">
            <FileInput
              label="분양회수 회차 추가"
              description="분양회수 예측오차에는 기준월과 그 전 석 달의 회차(모두 네 개)가 필요합니다. 위에서 올린 이전·최신 회차 말고 더 필요한 회차를 여러 개 올리세요. 저장하지 않으므로 새로고침하면 다시 올립니다. 파일 원본은 서버로 보내지 않습니다."
              placeholder={isAdding ? '읽는 중…' : '자금수지표 파일 선택(여러 개)'}
              accept=".xlsx,.xls"
              isMultiple
              isDisabled={isAdding}
              value={pickedFiles}
              onChange={(files) => {
                const list = files === null ? [] : Array.isArray(files) ? files : [files];
                setPickedFiles(list);
                if (list.length > 0) void addRounds(list);
              }}
            />
            {uploaded.length > 0 && (
              <Button
                label="추가한 회차 비우기"
                variant="secondary"
                onClick={() => {
                  setUploaded([]);
                  setReadNote(null);
                }}
              />
            )}
          </HStack>
        </>
      )}
    </VStack>
  );
}

/** 회차에서 분양회수 기재분을 뗀다. 못 떼면 파일 이름과 사유. */
function entryOf(file: string, statement: Statement): RoundEntry | { file: string; reason: string } {
  try {
    return roundEntryOf(statement);
  } catch (e) {
    return { file, reason: `분양회수를 뗄 수 없습니다 — ${e instanceof Error ? e.message : e}` };
  }
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
                예측오차는 원값이 아니라 올린 회차로 계산한 3개월 누적 오차율입니다.
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
          종합위기단계: 20 미만 정상 · 40 미만 주의 · 60 미만 경고 · 60 이상 위기. 기준월은 최신 회차(없으면
          오늘)의 달에서 2개월 전이며, 자금수지표 기준월 선택과는 따로 움직입니다.
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
