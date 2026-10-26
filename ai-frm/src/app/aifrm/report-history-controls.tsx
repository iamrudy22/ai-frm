'use client';

import type { ReactNode } from 'react';
import { Table, proportional } from '@astryxdesign/core/Table';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { useReportHistory } from './use-report-history';
import type { HistorySourceSummary } from '@/application/report-history/history-view';

type Controller = ReturnType<typeof useReportHistory>;
export function ReportControlSurface({ children }: { readonly children: ReactNode }) {
  return <Card variant="default" className="report-controls"><VStack gap={3}>{children}</VStack></Card>;
}

export function ReportHistorySourceSummary({ summary, archived = false }: { readonly summary: HistorySourceSummary; readonly archived?: boolean }) {
  const line = (label: string, counts: HistorySourceSummary['construction']) =>
    `${label} · 확정 ${counts.confirmed}개월 · 보완 ${counts.backfill}개월${counts.unconfirmed ? ` · 미확정 이력 ${counts.unconfirmed}개월` : ''}${counts.current ? ` · 현재 산출 ${counts.current}개월` : ''}`;
  return <VStack as="section" gap={1} className="report-controls" aria-label="외부 위험 이력 출처">
    <Text type="supporting">{archived ? '저장된 확정 문서의 표시 이력' : '현재 보고서의 표시 이력'}</Text>
    <Text type="supporting">{line('건설경기', summary.construction)}</Text>
    <Text type="supporting">{line('조달위험', summary.funding)}</Text>
  </VStack>;
}

export function ReportHistoryControls({ history, summary }: { readonly history: Controller; readonly summary?: HistorySourceSummary | null }) {
  const selected = history.batches.find(batch => batch.batchId === history.selectedBatchId);
  const completed = selected?.completedCycles.length ?? 0;
  const total = completed + (selected?.pendingCycles.length ?? 0);
  return <VStack as="section" gap={2} className="report-controls" aria-label="외부 위험 이력 보완">
    <HStack gap={2} wrap="wrap" align="center">
      <Heading level={2}>외부 위험 이력</Heading>
      <StatusDot variant={history.error ? 'warning' : history.running ? 'accent' : history.view ? 'success' : 'neutral'} label={history.status} />
      <Text type="supporting" aria-live="polite">{history.status}</Text>
    </HStack>
    {summary && <ReportHistorySourceSummary summary={summary} />}
    {selected && total > 0 && <ProgressBar label="과거 회차 보완 진행" value={completed} max={total} hasValueLabel formatValueLabel={(value, max) => `${value}/${max}회차`} />}
    <HStack gap={2} wrap="wrap">
      <Button label={history.running ? '보완 일시 중지' : history.plan ? '과거 18회차 보완 시작' : '보완 준비 확인'} size="sm" variant="secondary" isDisabled={!history.running && !history.canStart} onClick={() => history.running ? history.cancel() : history.plan ? void history.start() : void history.prepare()} />
      <Button label="기존 보완 작업 조회" size="sm" variant="ghost" onClick={() => void history.refresh()} />
    </HStack>
    {history.error && <Text type="supporting" color="secondary" aria-live="polite">{history.error}</Text>}
    <Collapsible trigger="보완 범위·준비 상태와 기존 작업" defaultIsOpen={false}>
      <VStack gap={2}>
        <Text type="supporting">최대 범위 {history.range ?? '기준회차 선택 전'} · 부족 회차가 있어도 가능한 달은 산출합니다. 누락 월은 차트에서 연결하지 않습니다.</Text>
        {history.unreadableRounds > 0 && <Text type="supporting">읽을 수 없는 회차 {history.unreadableRounds}개는 부족 회차로 표시합니다.{!history.canStart ? ' 최신 회차를 읽을 수 없어 시작할 수 없습니다.' : ''}</Text>}
        {history.plan?.readiness.map(row => row.missingRounds.length || row.localReason ?
          <Text key={row.reportCycle} type="supporting">{row.reportCycle}: 부족 회차 {row.missingRounds.join('·') || '없음'}{row.localReason ? ` · ${row.localReason}` : ''}</Text> : null)}
        {history.batches.length === 0 && <Text type="supporting">재개할 보완 작업이 없습니다.</Text>}
        {history.batches.map(batch => <HStack key={batch.batchId} gap={2} wrap="wrap" align="center">
          <Text type="supporting">{batch.fromCycle}~{batch.toCycle} · {batch.completedCycles.length}/{batch.completedCycles.length + batch.pendingCycles.length}회차 · 이전 입력일 수 있음</Text>
          <Button label={`${batch.fromCycle} 작업 이력 선택`} size="sm" variant="ghost" onClick={() => history.applyBatch(batch.batchId)} />
          {batch.status !== 'completed' && <Button label={`${batch.fromCycle} 작업 명시적 재개`} size="sm" variant="secondary" isDisabled={history.running} onClick={() => void history.resume(batch)} />}
        </HStack>)}
        {history.selectedBatchId && <Button label="선택한 보완 제외" size="sm" variant="ghost" onClick={() => history.applyBatch(null)} />}
      </VStack>
    </Collapsible>
  </VStack>;
}

type Preview = import('@/application/report-history/ports').StoredCorrectionPreview;
type PreviewConfirmation = { readonly kind: 'unconfirmed' | 'unknown' } | { readonly kind: 'confirmed'; readonly revision: number };
type RecordValue = Record<string, unknown>;
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
const metricName: Record<string, string> = { recovery: '대금 회수 위험', liquidity: '유동성 Gap', cash: '적정 시재', construction: '건설경기 인식 지수', funding: '조달위험 인식 지수' };
const displayValue = (value: unknown): string => value === null ? '결측' : typeof value === 'number' ? value.toString() : typeof value === 'string' ? value : '';
function identityLabel(value: unknown): string {
  const row = value as RecordValue;
  if (!row) return '';
  const bond = row.bond === 'publicAaa' ? '공사채 AAA 1년' : row.bond === 'treasury' ? '국고채 1년' : '';
  return [row.item ?? row.indicator ?? bond, row.month ?? row.date].filter(Boolean).join(' · ');
}
const columns = (items: readonly [string, string][]) => items.map(([key, header]) => ({ key, header, width: proportional(1) }));
export function CorrectionPreviewDetails({ preview, confirmation = { kind: 'unknown' } }: { readonly preview: Preview; readonly confirmation?: PreviewConfirmation }) {
  const raw: RecordValue[] = records(preview.rawDiff).map(row => ({ ...row, label: identityLabel(row.identity), before: displayValue(row.before), after: displayValue(row.after) }));
  const results: RecordValue[] = records(preview.resultDiff).map(row => ({ ...row, label: metricName[String(row.indicator)] ?? String(row.indicator), before: displayValue(row.beforeDisplay), after: displayValue(row.afterDisplay), change: row.changed ? '산출값 변화 있음' : '산출값 변화 없음' }));
  const impacts: RecordValue[] = records(preview.affectedReports).map(row => ({ ...row, label: metricName[String(row.indicator)] ?? String(row.indicator), status: row.status === 'recalculated' ? (row.changed ? '재계산 시 변화 있음' : '재계산 시 변화 없음') : '영향 가능 · 재계산 불가' }));
  return <VStack gap={2} aria-label="정정 차이 미리보기">
    <Text role="status">{confirmation.kind === 'confirmed' ? `정정 확정됨 · ${confirmation.revision}차` : confirmation.kind === 'unconfirmed' ? '검증 완료 · 미확정' : '저장된 정정 미리보기'} · 기준 {preview.baseRevision}차</Text>
    <Heading level={4}>원자료 변경</Heading>
    <Table data={raw} idKey="rowId" density="compact" dividers="grid" columns={columns([['label', '항목·월'], ['before', '수정 전'], ['after', '수정 후'], ['unit', '단위'], ['reason', '정정 사유'], ['evidenceNote', '근거 메모']])} />
    <Heading level={4}>산출값·등급·산출불가 비교</Heading>
    <Table data={results} idKey="indicator" density="compact" columns={columns([['label', '지표'], ['before', '수정 전'], ['after', '수정 후'], ['change', '변화']])} />
    <Heading level={4}>다른 보고서 영향</Heading>
    {impacts.length ? <Table data={impacts} density="compact" columns={columns([['reportCycle', '보고 회차'], ['revision', '차수'], ['label', '지표'], ['status', '영향'], ['reason', '안내']])} /> : <Text type="supporting">같은 원천·입력을 공유하는 다른 확정본의 영향이 없습니다.</Text>}
    <Text type="supporting">기존 확정본과 다른 보고서는 변경되지 않았습니다.</Text>
  </VStack>;
}
