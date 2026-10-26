'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Table, proportional } from '@astryxdesign/core/Table';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
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

type Controller = ReturnType<typeof useReportHistory>;
export function ReportControlSurface({ children }: { readonly children: ReactNode }) {
  return <Card variant="default" className="report-controls"><VStack gap={3}>{children}</VStack></Card>;
}

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

type Preview = import('@/application/report-history/ports').StoredCorrectionPreview;
type ImportResult = import('@/application/report-history/ports').ImportResult;
type CorrectionConfirmCommand = import('@/application/report-history/ports').CorrectionConfirmCommand;
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
    <Text type="supporting">미리보기 ID {preview.previewId} · 기존 확정본과 다른 보고서는 변경되지 않았습니다.</Text>
  </VStack>;
}
export function WorkbookCorrectionControls({ onConfirmed }: { readonly onConfirmed?: (confirmationId: string) => void } = {}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('정정용 엑셀의 수정본을 선택하세요.');
  const [result, setResult] = useState<ImportResult | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [previewId, setPreviewId] = useState(''), [reason, setReason] = useState(''), [confirmedId, setConfirmedId] = useState<string | null>(null), [confirmedRevision, setConfirmedRevision] = useState<number | null>(null);
  const generation = useRef(0), operation = useRef<AbortController | null>(null), command = useRef<CorrectionConfirmCommand | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const change = (value: File | File[] | null) => {
    operation.current?.abort();
    generation.current++;
    setBusy(false);
    setFile(Array.isArray(value) ? value[0] ?? null : value);
    setResult(null);
    setPreview(null);
    setConfirmedId(null); setConfirmedRevision(null); command.current = null;
    setMessage('수정본 검증을 눌러 변경 내용을 확인하세요.');
  };
  const changePreviewId = (value: string) => {
    operation.current?.abort(); generation.current++;
    setPreviewId(value); setPreview(null); setResult(null); setConfirmedId(null); setConfirmedRevision(null);
    command.current = null; setBusy(false);
    setMessage('저장된 미리보기를 열어 내용을 확인하세요.');
  };
  const explain = (status: number, code: string) => status === 409 ? '기준 확정본이나 참조 이력이 바뀌었습니다. 새로 엑셀을 내보내 수정안을 옮긴 뒤 검증하세요.' : code === 'EVALUATION_ZONE_MISMATCH' ? '원래 평가 시간대에서 서버를 실행한 뒤 검증하세요.' : status === 413 ? '파일은 5MiB 이하이며 시트·행·셀 한도를 지켜야 합니다.' : status === 503 ? '저장소에 연결하지 못했습니다. 잠시 후 재검증하세요.' : '파일 또는 미리보기 정보를 확인하세요.';
  const load = async (id: string, signal: AbortSignal) => {
    const response = await fetch(`/api/report-history/exchange?previewId=${encodeURIComponent(id)}`, { cache: 'no-store', signal });
    const body = await response.json();
    if (!response.ok) throw Error(explain(response.status, body.code));
    return body.preview as Preview;
  };
  const validate = async () => {
    if (!file || busy) return;
    const token = ++generation.current, controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    setBusy(true);
    setResult(null);
    setPreview(null);
    setConfirmedId(null); setConfirmedRevision(null); command.current = null;
    setMessage('수정본 검증 중');
    try {
      const form = new FormData();
      form.set('command', 'validate');
      form.set('file', file);
      const response = await fetch('/api/report-history/exchange', { method: 'POST', body: form, signal: controller.signal });
      const body = await response.json();
      if (token !== generation.current) return;
      if (!response.ok && body.result?.kind !== 'invalid') throw Error(explain(response.status, body.code));
      const validated = body.result as ImportResult;
      setResult(validated);
      if (validated.kind === 'invalid') setMessage('검증 오류 · 표시된 셀을 고친 파일을 다시 선택해 검증하세요.');
      else if (validated.kind === 'no-change') setMessage('변경 없음 · 기존 원자료와 확정본을 유지합니다.');
      else {
        setPreviewId(validated.previewId);
        const saved = await load(validated.previewId, controller.signal);
        if (token === generation.current) {
          setPreview(saved);
          setMessage('검증 완료 · 차이 미리보기');
        }
      }
    } catch (error) { if (token === generation.current && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : '검증하지 못했습니다.'); }
    finally { if (token === generation.current) setBusy(false); }
  };
  const reopen = async () => {
    if (busy || !previewId.trim()) return;
    const token = ++generation.current, controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    setBusy(true);
    setPreview(null);
    setResult(null);
    setConfirmedId(null); setConfirmedRevision(null); command.current = null;
    setMessage('미리보기 불러오는 중');
    try {
      const saved = await load(previewId.trim(), controller.signal);
      if (token === generation.current) {
        setPreview(saved);
        setResult(null);
        setMessage('저장된 정정 미리보기 · 확정 이력에서 상태를 확인할 수 있습니다.');
      }
    }
    catch (error) { if (token === generation.current && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : '미리보기를 열지 못했습니다.'); }
    finally { if (token === generation.current) setBusy(false); }
  };
  const confirm = async () => {
    if (!preview || !reason.trim() || busy || confirmedId) return;
    const token = generation.current, controller = new AbortController();
    operation.current?.abort(); operation.current = controller;
    const attempt = command.current ?? { previewId: preview.previewId, previewHash: preview.previewHash, expectedBaseRevision: preview.baseRevision,
      idempotencyKey: crypto.randomUUID(), reason: reason.trim() };
    command.current = attempt;
    setBusy(true); setMessage('정정 확정 저장 중');
    try {
      const response = await fetch('/api/report-history/corrections', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(attempt), signal: controller.signal });
      const body = await response.json();
      if (token !== generation.current) return;
      if (response.status === 409) {
        command.current = null;
        setMessage('정정 충돌 · 새 엑셀을 내보내 같은 수정안을 다시 입력하고 검증하세요. 기존 파일 재검증으로는 해결되지 않습니다.');
        return;
      }
      if (!response.ok || !body.ok) throw Error(response.status === 503 ? '저장 결과를 확인하지 못했습니다.' : response.status === 422 ? '정정 사유 또는 미리보기 정보를 확인하세요.' : '정정 확정 요청을 완료하지 못했습니다.');
      if (body.result?.kind !== 'confirmed' && body.result?.kind !== 'already-confirmed') throw Error('확정 결과를 확인하지 못했습니다. 같은 명령으로 재시도하세요.');
      setConfirmedId(body.result.confirmationId);
      setConfirmedRevision(body.result.revision);
      setMessage(`정정 확정됨 · ${body.result.revision}차`);
      onConfirmed?.(body.result.confirmationId);
    } catch (error) { if (token === generation.current && !controller.signal.aborted) setMessage(`${error instanceof Error ? error.message : '결과를 확인하지 못했습니다.'} 같은 정정 확정 명령으로 재시도하세요.`); }
    finally { if (token === generation.current) setBusy(false); }
  };
  return <VStack as="section" gap={2} className="report-controls" aria-label="엑셀 수정본 검증">
    <Heading level={3}>수정본 가져오기</Heading>
    <FileInput label="정정용 엑셀 수정본" placeholder="엑셀 수정본을 놓거나 클릭하여 선택" value={file} onChange={change} accept=".xlsx" maxSize={5 * 1024 * 1024} description="앱에서 내보낸 .xlsx · 최대 5MiB · 수정 동작·수정 값·사유·근거 메모만 편집" mode="dropzone" />
    <Button label={busy ? '검증 중' : '수정본 검증'} isDisabled={!file} aria-disabled={busy} aria-busy={busy} variant="secondary" onClick={() => void validate()} />
    <Text role="status" aria-live="polite">{message}</Text>
    {result?.kind === 'invalid' && <Table data={result.errors.map((error, index) => ({ id: String(index), location: [error.sheet, error.column && error.row ? `${error.column}${error.row}` : error.column].filter(Boolean).join(' · ') || '파일', message: error.message }))} idKey="id" density="compact" columns={columns([['location', '오류 위치'], ['message', '원인']])} />}
    {preview && <CorrectionPreviewDetails preview={preview} confirmation={confirmedId && confirmedRevision !== null ? { kind: 'confirmed', revision: confirmedRevision } : result?.kind === 'preview' ? { kind: 'unconfirmed' } : { kind: 'unknown' }} />}
    {preview && !confirmedId && <VStack gap={2} align="start">
      <TextArea label="전체 정정 사유" value={reason} onChange={value => { setReason(value); command.current = null; }} isRequired maxLength={2000} />
      <Button label="정정 확정" variant="secondary" isDisabled={!reason.trim() || busy || message.startsWith('정정 충돌')} aria-busy={busy} onClick={() => void confirm()} />
    </VStack>}
    {confirmedId && <Text role="status">정정 확정됨 · 이전 확정본과 새 확정본은 확정 이력에서 열 수 있습니다.</Text>}
    <Collapsible trigger="저장된 미리보기 다시 열기" defaultIsOpen={false}><VStack gap={2}>
      <TextInput label="미리보기 ID" value={previewId} onChange={changePreviewId} />
      <Button label="미리보기 열기" variant="ghost" isDisabled={!previewId.trim()} aria-disabled={busy} aria-busy={busy} onClick={() => void reopen()} />
    </VStack></Collapsible>
  </VStack>;
}
