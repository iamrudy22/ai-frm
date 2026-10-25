'use client';

import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { useReportHistory } from './use-report-history';

type Controller = ReturnType<typeof useReportHistory>;
export function ReportHistoryControls({ history }: { readonly history: Controller }) {
  const selected = history.batches.find(batch => batch.batchId === history.selectedBatchId);
  const completed = selected?.completedCycles.length ?? 0;
  const total = completed + (selected?.pendingCycles.length ?? 0);
  const saved = history.view?.points.filter(item => item.point.kind === 'available').length ?? 0;
  return <VStack as="section" gap={2} className="report-controls" aria-label="외부 위험 이력 보완">
    <HStack gap={2} wrap="wrap" align="center">
      <Heading level={2}>외부 위험 이력</Heading>
      <StatusDot variant={history.error ? 'warning' : history.running ? 'accent' : history.view ? 'success' : 'neutral'} label={history.status} />
      <Text type="supporting" aria-live="polite">{history.status}</Text>
      {history.view && <Text type="supporting">저장된 산출 이력 {saved}개 · {history.selectedBatchId ? '선택한 보완 포함' : '확정 저장 이력 기준'}</Text>}
    </HStack>
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
