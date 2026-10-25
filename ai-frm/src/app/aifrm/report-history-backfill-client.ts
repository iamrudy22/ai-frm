export type HistoryBatch = {
  readonly batchId: string;
  readonly startKey: string;
  readonly scopeId: string;
  readonly fromCycle: string;
  readonly toCycle: string;
  readonly inputHash?: string;
  readonly completedCycles: readonly string[];
  readonly pendingCycles: readonly string[];
  readonly status: 'pending-source' | 'running' | 'completed';
};
export type StepResponse = { readonly status: 202; readonly retryAfterSeconds: number } | { readonly status: 200; readonly batch: HistoryBatch };
export type StepDependencies = { readonly step: () => Promise<StepResponse>; readonly wait: (ms: number, signal: AbortSignal) => Promise<void>; readonly onBatch: (batch: HistoryBatch) => void };
export function canStartHistoryBackfill(reportCycle: string | null, rounds: readonly { readonly round: string }[] | null): boolean {
  return !!reportCycle && !!rounds?.some(round => round.round === reportCycle);
}
export function historySelectionKey(inputKey: string, reportCycle: string, constructionAnchor: string, gapMonth: string, batchId: string | null, revision: number): string {
  return JSON.stringify([inputKey, reportCycle, constructionAnchor, gapMonth, batchId, revision]);
}
/** A batch step changes the selectable snapshot even if the user currently has that batch deselected. */
export function advanceHistorySelectionRevision(revision: number, before: HistoryBatch, after: HistoryBatch): number {
  return before.batchId === after.batchId && (before.status !== after.status || before.completedCycles.length !== after.completedCycles.length)
    ? revision + 1 : revision;
}
function check(signal: AbortSignal): void { if (signal.aborted) throw Error('ABORTED'); }
export function waitForHistory(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(Error('ABORTED')); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(Error('ABORTED')); };
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** Sequential one-cycle requests. Busy captures wait for the server's Retry-After. */
export async function runHistorySteps(initial: HistoryBatch, signal: AbortSignal, deps: StepDependencies): Promise<HistoryBatch> {
  let batch = initial;
  while (batch.status !== 'completed') {
    check(signal);
    const response = await deps.step();
    check(signal);
    if (response.status === 202) {
      await deps.wait(Math.max(1000, response.retryAfterSeconds * 1000), signal);
      continue;
    }
    batch = response.batch;
    deps.onBatch(batch);
    if (batch.pendingCycles.length === 0) return batch;
  }
  return batch;
}
