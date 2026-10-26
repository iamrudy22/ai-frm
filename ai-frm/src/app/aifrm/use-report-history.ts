'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RoundEntry } from '@/domain/cashflow/round-entry';
import { addMonths, type YearMonth } from '@/domain/shared/year-month';
import type { ExternalHistoryView } from '@/application/report-history/history-view';
import { advanceHistorySelectionRevision, canStartHistoryBackfill, historySelectionKey, runHistorySteps, waitForHistory, type HistoryBatch, type StepResponse } from './report-history-backfill-client';

export type HistoryReadiness = { readonly reportCycle: string; readonly missingRounds: readonly string[]; readonly localReason: string | null };
type Plan = { readonly cycles: readonly string[]; readonly readiness: readonly HistoryReadiness[] };
type Input = { readonly reportCycle: YearMonth | null; readonly constructionAnchor: YearMonth | null; readonly gapMonth: YearMonth | null; readonly rounds: readonly RoundEntry[] | null; readonly unreadableRounds: number; readonly reportOpen: boolean };
type Json = Record<string, unknown>;
async function responseJson(url: string, init?: RequestInit): Promise<{ response: Response; body: Json }> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const body = await response.json() as Json;
  return { response, body };
}
const post = (body: unknown, signal: AbortSignal) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
function errorOf(response: Response, body: Json): Error { return Error(typeof body.code === 'string' ? body.code : `HTTP_${response.status}`); }
export function historySelectionErrorMessage(code: string): string {
  const alternative = ' 다른 작업을 선택하거나 보완을 제외해 주세요.';
  if (code === 'BATCH_RANGE_MISMATCH') return `선택한 보완 작업의 범위가 현재 보고서와 맞지 않습니다.${alternative}`;
  if (code === 'BATCH_VERSION_MISMATCH' || code === 'UNSUPPORTED_CALCULATION_VERSION') return `선택한 이력의 계산 버전이 현재 보고서와 맞지 않습니다.${alternative}`;
  if (code === 'HISTORY_NOT_FOUND') return `선택한 보완 작업을 찾지 못했습니다.${alternative}`;
  return code === 'STORAGE_UNAVAILABLE' ? '이력 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' : `이력을 선택하지 못했습니다.${alternative}`;
}

export function invalidateHistorySelection(cache: Map<string, ExternalHistoryView>, advance: () => void): void {
  cache.clear();
  advance();
}

export function useReportHistory(input: Input) {
  const inputKey = useMemo(() => input.reportCycle === null ? '' : JSON.stringify({ reportCycle: input.reportCycle, rounds: input.rounds }), [input.reportCycle, input.rounds]);
  const [batches, setBatches] = useState<readonly HistoryBatch[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [selection, setSelection] = useState<{ key: string; view: ExternalHistoryView } | null>(null);
  const [status, setStatus] = useState('보완 이력 대기');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const startAttempt = useRef<{ key: string; startKey: string } | null>(null);
  const selectedInputKey = useRef('');
  const cache = useRef(new Map<string, ExternalHistoryView>());

  const refresh = useCallback(async () => {
    try {
      const { response, body } = await responseJson('/api/report-history/backfill?all=1');
      if (!response.ok) throw errorOf(response, body);
      setBatches(body.batches as HistoryBatch[]);
    } catch { setError('기존 보완 작업 목록을 읽지 못했습니다. 다시 조회할 수 있습니다.'); }
  }, []);
  useEffect(() => { queueMicrotask(() => void refresh()); }, [refresh]);
  useEffect(() => {
    operation.current?.abort();
    if (selectedInputKey.current !== inputKey) {
      selectedInputKey.current = inputKey;
    }
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      setRunning(false);
      setPlan(null);
      setSelectedBatchId(null);
    });
    return () => { live = false; };
  }, [inputKey]);
  useEffect(() => () => operation.current?.abort(), []);

  const selectedForInput = selectedInputKey.current === inputKey ? selectedBatchId : null;
  const selectionKey = input.reportCycle && input.constructionAnchor && input.gapMonth
    ? historySelectionKey(inputKey, input.reportCycle, input.constructionAnchor, input.gapMonth, selectedForInput, selectionRevision) : '';
  useEffect(() => {
    if (!input.reportOpen || !selectionKey || !input.reportCycle || !input.constructionAnchor || !input.gapMonth) return;
    const cached = cache.current.get(selectionKey);
    if (cached) { setSelection({ key: selectionKey, view: cached }); return; }
    const controller = new AbortController();
    let live = true;
    setStatus('저장된 이력 선택 중');
    void (async () => {
      try {
        const { response, body } = await responseJson('/api/report-history/selection', post({ reportCycle: input.reportCycle, constructionBaseMonth: input.constructionAnchor, gapMonth: input.gapMonth, selectedBackfillBatchId: selectedForInput }, controller.signal));
        if (!response.ok) throw Error(historySelectionErrorMessage(errorOf(response, body).message));
        const view = body.view as ExternalHistoryView;
        if (live) { cache.current.set(selectionKey, view); setSelection({ key: selectionKey, view }); setStatus('저장된 이력 선택 완료'); setError(null); }
      } catch (cause) {
        if (live && !controller.signal.aborted) { setError(cause instanceof Error ? cause.message : '이력을 선택하지 못했습니다.'); setStatus('이력 선택 실패'); }
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [input.reportOpen, input.reportCycle, input.constructionAnchor, input.gapMonth, selectedForInput, selectionKey]);

  const applyBatch = useCallback((batchId: string | null) => { selectedInputKey.current = inputKey; setSelectedBatchId(batchId); setStatus(batchId ? '선택한 보완 이력을 보고서에 적용합니다.' : '확정된 저장 이력만 선택합니다.'); }, [inputKey]);
  const run = useCallback(async (batch: HistoryBatch, controller: AbortController) => {
    const result = await runHistorySteps(batch, controller.signal, {
      step: async (): Promise<StepResponse> => {
        const { response, body } = await responseJson('/api/report-history/backfill', post({ action: 'step', batchId: batch.batchId }, controller.signal));
        if (response.status === 202) return { status: 202, retryAfterSeconds: Math.max(Number(response.headers.get('retry-after')) || 1, Number(body.retryAfterSeconds) || 1) };
        if (!response.ok) throw errorOf(response, body);
        return { status: 200, batch: body.batch as HistoryBatch };
      }, wait: waitForHistory,
      onBatch: next => { setBatches(previous => [next, ...previous.filter(item => item.batchId !== next.batchId)]); setStatus(`${next.completedCycles.length}/${next.completedCycles.length + next.pendingCycles.length}회차 보완 완료`); setSelectionRevision(value => advanceHistorySelectionRevision(value, batch, next)); },
    });
    applyBatch(result.batchId);
    await refresh();
  }, [applyBatch, refresh]);
  const resume = useCallback(async (batch: HistoryBatch) => {
    operation.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    setRunning(true); setError(null); setStatus('선택한 기존 보완 작업 재개 중');
    try { await run(batch, controller); }
    catch (cause) { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : '보완 작업을 재개하지 못했습니다.'); setStatus('보완 중단 · 다시 재개할 수 있습니다.'); } }
    finally { if (operation.current === controller) { operation.current = null; setRunning(false); } }
  }, [run]);
  const prepare = useCallback(async () => {
    if (!canStartHistoryBackfill(input.reportCycle, input.rounds)) return;
    operation.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    setRunning(true); setError(null); setStatus('보완 범위와 부족 회차 확인 중');
    try {
      const planned = await responseJson('/api/report-history/backfill', post({ action: 'plan', fromCycle: addMonths(input.reportCycle!, -17), toCycle: input.reportCycle, rounds: input.rounds }, controller.signal));
      if (!planned.response.ok) throw errorOf(planned.response, planned.body);
      setPlan(planned.body.plan as Plan);
      setStatus('준비 확인 완료 · 보완 시작을 눌러 원천 조회');
    } catch (cause) {
      if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : '보완 준비를 확인하지 못했습니다.'); setStatus('준비 확인 실패'); }
    } finally { if (operation.current === controller) { operation.current = null; setRunning(false); } }
  }, [input.reportCycle, input.rounds]);
  const start = useCallback(async () => {
    if (!canStartHistoryBackfill(input.reportCycle, input.rounds) || !plan) return;
    operation.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    setRunning(true); setError(null); setStatus('과거 회차 보완 시작 중');
    const startKey = startAttempt.current?.key === inputKey ? startAttempt.current.startKey : crypto.randomUUID();
    startAttempt.current = { key: inputKey, startKey };
    const payload = { fromCycle: addMonths(input.reportCycle!, -17), toCycle: input.reportCycle, rounds: input.rounds };
    try {
      let batch: HistoryBatch;
      for (;;) {
        if (controller.signal.aborted) throw Error('ABORTED');
        const started = await responseJson('/api/report-history/backfill', post({ action: 'start', ...payload, startKey }, controller.signal));
        if (started.response.status === 202) {
          await waitForHistory(Math.max(1000, Number(started.response.headers.get('retry-after')) * 1000 || 1000), controller.signal);
          continue;
        }
        if (!started.response.ok) throw errorOf(started.response, started.body);
        batch = started.body.batch as HistoryBatch;
        break;
      }
      setBatches(previous => [batch, ...previous.filter(item => item.batchId !== batch.batchId)]);
      setStatus(`${batch.completedCycles.length}/${batch.completedCycles.length + batch.pendingCycles.length}회차 보완 완료`);
      await run(batch, controller);
      startAttempt.current = null;
    } catch (cause) {
      if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : '보완 작업을 시작하지 못했습니다.'); setStatus('보완 중단 · 같은 요청으로 다시 시도할 수 있습니다.'); }
    } finally { if (operation.current === controller) { operation.current = null; setRunning(false); } }
  }, [input.reportCycle, input.rounds, inputKey, plan, run]);
  const invalidateSelection = useCallback(() => { invalidateHistorySelection(cache.current, () => setSelectionRevision(value => value + 1)); }, []);
  const cancel = useCallback(() => { operation.current?.abort(); operation.current = null; setRunning(false); setStatus('보완 일시 중지'); }, []);
  return { batches, plan, selectedBatchId: selectedForInput, view: selection?.key === selectionKey ? selection.view : null, status, error, running, refresh, invalidateSelection, prepare, start, resume, cancel, applyBatch,
    canStart: canStartHistoryBackfill(input.reportCycle, input.rounds), range: input.reportCycle ? `${addMonths(input.reportCycle, -17)}~${input.reportCycle}` : null, unreadableRounds: input.unreadableRounds };
}
