import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, statSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { decodeEvidence } from './evidence-codec';
import { SqliteHistoryRepository } from './sqlite-history-repository';
import type { ReportBasis, CalculationWrite, EvidenceWrite, CandidateWrite, StatementSnapshotDto, ConfirmationResult } from '../../application/report-history/ports';
import { yearMonth } from '../../domain/shared/year-month';
const dirs: string[] = [];
const repos: SqliteHistoryRepository[] = [];
const now = '2026-10-23T00:00:00.000Z', month = yearMonth(2026, 9), version = 'risk-policy-2026-09-28@e3a8f9e';
const basis: ReportBasis = { reportCycle: month, reportTitleMonth: yearMonth(2026, 8), constructionBaseMonth: yearMonth(2026, 7), fundingJudgedMonth: month, fundingObservedMonth: yearMonth(2026, 8), gapMonth: month };
function open(path?: string, options: Parameters<typeof make>[1] = {}) { const r = make(path, options); repos.push(r); return r; }
function make(path?: string, options: {
  readOnly?: boolean;
  now?: () => string;
} = {}) { if (!path) {
  const d = mkdtempSync(join(tmpdir(), 'aifrm-history-'));
  dirs.push(d);
  path = join(d, 'data', 'report-history.sqlite');
} return new SqliteHistoryRepository(path, { now: () => now, ...options }); }
afterEach(() => { for (const r of repos.splice(0))
  r.close(); for (const d of dirs.splice(0))
  rmSync(d, { recursive: true, force: true }); });
async function fixture(r: SqliteHistoryRepository, scopeId = 'scope-A', tag = 'first', candidateBasis = basis) {
  const evidence: EvidenceWrite = { scopeId, sourceKind: 'ecos', contentHash: 'source-' + tag, payloadJson: { value: 0, unit: '지수', failure: { error: '합성 실패' } }, schemaVersion: 1, receivedAt: now, derivation: { kind: 'captured' } };
  const { captureId } = await r.putEvidence(evidence);
  const { inputSnapshotId } = await r.putInputSnapshot({ scopeId, statements: [], sourceMetadata: { file: 'synthetic' }, inputHash: 'input-' + tag, derivation: { kind: 'captured' }, createdAt: now });
  const common: Omit<CalculationWrite, 'indicator'> = { scopeId, origin: 'live', derivation: { kind: 'captured' }, effectiveMonth: candidateBasis.constructionBaseMonth, requestContext: { basis: candidateBasis.reportCycle }, inputHash: 'ledger-' + tag, calculationVersion: version, captureIds: [captureId], resultJson: { kind: 'failed', reason: '합성 결과' }, evaluatedAt: now, evaluationClockTrace: [now, '2026-10-23T00:00:00.001Z'], evaluatedCalendar: { year: 2026, month: 10, day: 23 }, evaluationTimeZone: 'Asia/Seoul', createdAt: now };
  const construction = (await r.putCalculation({ ...common, indicator: 'construction' })).calculationId;
  const funding = (await r.putCalculation({ ...common, indicator: 'funding', effectiveMonth: candidateBasis.fundingObservedMonth, inputHash: 'judged-' + tag })).calculationId;
  const selection = await r.createHistorySelection({ scopeId, basis: candidateBasis, calculationVersion: version, asOf: now, selectedBackfillBatchId: null });
  const candidate: CandidateWrite = { scopeId, basis: candidateBasis, inputSnapshotId, inputHash: 'input-' + tag, calculationInputHashes: { construction: 'ledger-' + tag, funding: 'judged-' + tag }, calculationVersion: version, authoredAt: now, preparedAt: now, calculationIds: { construction, funding }, historySelectionId: selection.historySelectionId, document: { schemaVersion: 1, templateVersion: 'report@e3a8f9e', contentHash: 'doc-' + tag, json: { synthetic: tag, value: 0.1234567890123456 }, historyCalculationIds: selection.historyCalculationIds }, correctionPreviewId: null };
  const { candidateId } = await r.putCandidate(candidate);
  return { candidateId, candidate, captureId, inputSnapshotId, construction, funding, common, evidence };
}
describe('SQLite 불변 월별 이력', () => {
  it('revision1·멱등·다른 후보 충돌·사유/CAS·과거 재시도로 head를 되돌리지 않음', async () => {
    const r = open(), f = await fixture(r), cmd = { candidateId: f.candidateId, expectedRevision: 0, idempotencyKey: 'key' };
    const first = await r.commitConfirmation('scope-A', cmd);
    expect(first.kind).toBe('confirmed');
    expect(first).toMatchObject({ revision: 1 });
    expect(await r.commitConfirmation('scope-A', cmd)).toEqual({ ...first, kind: 'already-confirmed' });
    const g = await fixture(r, 'scope-A', 'second');
    expect((await r.commitConfirmation('scope-A', { ...cmd, candidateId: g.candidateId })).kind).toBe('conflict');
    expect((await r.commitConfirmation('scope-A', { candidateId: g.candidateId, expectedRevision: 1, idempotencyKey: 'missing' })).kind).toBe('not-ready');
    expect((await r.commitConfirmation('scope-A', { candidateId: g.candidateId, expectedRevision: 0, idempotencyKey: 'stale', correctionReason: '합성 정정' })).kind).toBe('conflict');
    const second = await r.commitConfirmation('scope-A', { candidateId: g.candidateId, expectedRevision: 1, idempotencyKey: 'new', correctionReason: '합성 정정' });
    expect(second).toMatchObject({ kind: 'confirmed', revision: 2 });
    expect(await r.commitConfirmation('scope-A', { ...cmd, idempotencyKey: 'retry-old' })).toEqual({ ...first, kind: 'already-confirmed' });
    const h = await fixture(r, 'scope-A', 'third');
    expect(await r.commitConfirmation('scope-A', { candidateId: h.candidateId, expectedRevision: 2, idempotencyKey: 'third', correctionReason: '사유' })).toMatchObject({ revision: 3 });
  });
  it('scope 격리와 부모·원천·입력·문서 참조 검증', async () => {
    const r = open(), f = await fixture(r);
    expect(await r.getCandidate('scope-B', f.candidateId)).toBeNull();
    expect((await r.commitConfirmation('scope-B', { candidateId: f.candidateId, expectedRevision: 0, idempotencyKey: 'x' })).kind).toBe('not-ready');
    await expect(r.putCalculation({ ...f.common, scopeId: 'scope-B', indicator: 'construction' })).rejects.toThrow();
    await expect(r.putCandidate({ ...f.candidate, inputHash: 'wrong' })).rejects.toThrow();
    const noncanonicalBasis = { ...basis, reportTitleMonth: month };
    await expect(r.putCandidate({ ...f.candidate, basis: noncanonicalBasis })).rejects.toThrow('INVALID_BASIS');
    await expect(r.createHistorySelection({ scopeId: 'scope-A', basis: noncanonicalBasis, calculationVersion: version, asOf: now, selectedBackfillBatchId: null })).rejects.toThrow('INVALID_BASIS');
    await expect(r.putCandidate({ ...f.candidate, calculationInputHashes: { ...f.candidate.calculationInputHashes, funding: 'wrong' } })).rejects.toThrow('CALCULATION_CONTEXT_MISMATCH');
    await expect(r.putCandidate({ ...f.candidate, correctionPreviewId: 'future-preview' })).rejects.toThrow();
    const derived = await r.putCalculation({ ...f.common, indicator: 'construction', origin: 'live', derivation: { kind: 'manual-correction', parentId: f.construction, importId: 'synthetic-import', patchHash: 'patch', correctedAt: now } });
    expect((await r.getCalculation('scope-A', derived.calculationId))?.derivation).toMatchObject({ parentId: f.construction });
    await expect(r.putCalculation({ ...f.common, indicator: 'construction', origin: 'reconstructed', derivation: { kind: 'manual-correction', parentId: f.construction, importId: 'i', patchHash: 'p', correctedAt: now } })).rejects.toThrow();
  });
  it('정정 입력은 부모 Statement 순서·기준일·월 구조를 보존하고 금액만 바꿀 수 있다', async () => {
    const r = open();
    const first: StatementSnapshotDto = { asOf: { year: 2026, month: 8, day: 31 }, monthLabels: ['7월', '8월'], baseMonthIndex: 1, planYearEndIndex: 1, amounts: { 기초시재: [0, 1], 수입계: [2, 3], 수입: { unreadable: '합성 결측' }, 분양회수: [6, 7], 기타수입: [8, 9], 지출: [10, 11] } };
    const second: StatementSnapshotDto = { ...first, asOf: { year: 2026, month: 9, day: 30 } };
    const parent = await r.putInputSnapshot({ scopeId: 'scope-A', statements: [first, second], sourceMetadata: { file: 'synthetic' }, inputHash: 'parent', derivation: { kind: 'captured' }, createdAt: now });
    const write = { scopeId: 'scope-A', statements: [first, second], sourceMetadata: { file: 'synthetic correction' }, inputHash: 'child', derivation: { kind: 'manual-correction' as const, parentId: parent.inputSnapshotId, importId: 'synthetic-import', patchHash: 'patch', correctedAt: now }, createdAt: now };
    const changedAmounts = { ...first, amounts: { ...first.amounts, 기초시재: [0, -1.23456789] } };
    const accepted = await r.putInputSnapshot({ ...write, statements: [changedAmounts, second] });
    expect((await r.getInputSnapshot('scope-A', accepted.inputSnapshotId))?.statements[0].amounts.기초시재).toEqual([0, -1.23456789]);
    expect((await r.getInputSnapshot('scope-A', accepted.inputSnapshotId))?.statements[0].amounts.수입).toEqual({ unreadable: '합성 결측' });
    const repaired = { ...first, amounts: { ...first.amounts, 수입: [-1, 0] } };
    const repair = await r.putInputSnapshot({ ...write, statements: [repaired, second] });
    expect((await r.getInputSnapshot('scope-A', repair.inputSnapshotId))?.statements[0].amounts.수입).toEqual([-1, 0]);
    const wrongAmounts = [
      { ...first.amounts, 기초시재: [1] },
      { ...first.amounts, 기초시재: [1, 2, 3] },
      { ...first.amounts, 기초시재: { unreadable: '새 결측' } },
      { ...first.amounts, 수입: [0] },
      { ...first.amounts, 수입: new Array<number>(first.monthLabels.length) },
      { ...first.amounts, 수입: [0, Number.NaN] },
      { ...first.amounts, 수입: { unreadable: '바뀐 결측' } },
    ];
    for (const amounts of wrongAmounts) {
      await expect(r.putInputSnapshot({ ...write, statements: [{ ...first, amounts }, second] })).rejects.toThrow('INPUT_AMOUNT_STRUCTURE_MISMATCH');
    }
    const wrong = [
      [first], [second, first],
      [{ ...first, asOf: { year: 2026, month: 8, day: 30 } }, second],
      [{ ...first, monthLabels: ['6월', '8월'] }, second],
      [{ ...first, baseMonthIndex: 0 }, second],
      [{ ...first, planYearEndIndex: 0 }, second],
    ];
    for (const statements of wrong) {
      await expect(r.putInputSnapshot({ ...write, statements })).rejects.toThrow('INPUT_STRUCTURE_MISMATCH');
    }
  });
  it('증거 정정은 부모 원천/수신 시각을 보존하고 산출 clock trace를 복원한다', async () => {
    const r = open(), f = await fixture(r);
    expect((await r.getCalculation('scope-A', f.construction))?.evaluationClockTrace).toEqual(f.common.evaluationClockTrace);
    const derivation = { kind: 'manual-correction' as const, parentId: f.captureId, importId: 'i', patchHash: 'p', correctedAt: now };
    await expect(r.putEvidence({ ...f.evidence, receivedAt: '2026-10-24T00:00:00.000Z', derivation })).rejects.toThrow();
    await expect(r.putEvidence({ ...f.evidence, sourceKind: 'kofia', derivation })).rejects.toThrow();
  });
  it('지원하지 않는 산출/문서 버전과 평가 시각에 어긋난 로컬 달력을 거부한다', async () => {
    const r = open(), f = await fixture(r);
    await expect(r.putCalculation({ ...f.common, indicator: 'construction', calculationVersion: 'unknown' })).rejects.toThrow('UNSUPPORTED_CALCULATION_VERSION');
    await expect(r.putCalculation({ ...f.common, indicator: 'construction', evaluatedCalendar: { year: 2026, month: 10, day: 22 } })).rejects.toThrow('EVALUATION_CALENDAR_MISMATCH');
    await expect(r.putCandidate({ ...f.candidate, document: { ...f.candidate.document, templateVersion: 'unknown' } })).rejects.toThrow('UNSUPPORTED_TEMPLATE_VERSION');
    await expect(r.createHistorySelection({ scopeId: 'scope-A', basis, calculationVersion: 'unknown', asOf: now, selectedBackfillBatchId: null })).rejects.toThrow('UNSUPPORTED_CALCULATION_VERSION');
  });
  it('두 연결의 순차 CAS에서 1개만 승리한다', async () => {
    const a = open(), b = open(a.databasePath), f = await fixture(a), g = await fixture(a, 'scope-A', 'other');
    const results = await Promise.all([a.commitConfirmation('scope-A', { candidateId: f.candidateId, expectedRevision: 0, idempotencyKey: 'a' }), b.commitConfirmation('scope-A', { candidateId: g.candidateId, expectedRevision: 0, idempotencyKey: 'b' })]);
    expect(results.map(x => x.kind).sort()).toEqual(['confirmed', 'conflict']);
    expect(await a.listConfirmations('scope-A')).toHaveLength(1);
  });
  it('공통 시작 장벽에서 두 worker가 같은 SQLite head를 경합한다', async () => {
    const r = open();
    const first = await fixture(r);
    const second = await fixture(r, 'scope-A', 'worker-second');
    const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const source = `
      const { parentPort, workerData } = require('node:worker_threads');
      const fs = require('node:fs');
      const ts = require(workerData.typescriptPath);
      require.extensions['.ts'] = (module, filename) => {
        const source = fs.readFileSync(filename, 'utf8');
        const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        module._compile(output, filename);
      };
      const { SqliteHistoryRepository } = require(workerData.repositoryPath);
      const repository = new SqliteHistoryRepository(workerData.databasePath);
      parentPort.postMessage({ kind: 'ready' });
      Atomics.wait(new Int32Array(workerData.barrier), 0, 0);
      repository.commitConfirmation('scope-A', {
        candidateId: workerData.candidateId,
        expectedRevision: 0,
        idempotencyKey: workerData.idempotencyKey,
      }).then(result => {
        repository.close();
        parentPort.postMessage({ kind: 'result', result });
      }).catch(error => {
        repository.close();
        parentPort.postMessage({ kind: 'failure', message: error.message });
      });
    `;
    const workers: Worker[] = [];
    const ready: Promise<void>[] = [];
    const finished: Promise<ConfirmationResult>[] = [];
    for (const [candidateId, idempotencyKey] of [[first.candidateId, 'worker-first'], [second.candidateId, 'worker-second']]) {
      const worker = new Worker(source, { eval: true, workerData: {
        repositoryPath: join(process.cwd(), 'src/infrastructure/report-history/sqlite-history-repository.ts'),
        typescriptPath: join(process.cwd(), 'node_modules/typescript'),
        databasePath: r.databasePath, candidateId, idempotencyKey, barrier,
      } });
      workers.push(worker);
      const readySignal = Promise.withResolvers<void>();
      const resultSignal = Promise.withResolvers<ConfirmationResult>();
      worker.on('message', message => {
        if (message.kind === 'ready') readySignal.resolve();
        if (message.kind === 'result') resultSignal.resolve(message.result);
        if (message.kind === 'failure') resultSignal.reject(Error(message.message));
      });
      worker.on('error', error => { readySignal.reject(error); resultSignal.reject(error); });
      ready.push(readySignal.promise);
      finished.push(resultSignal.promise);
    }
    try {
      await Promise.all(ready);
      Atomics.store(new Int32Array(barrier), 0, 1);
      Atomics.notify(new Int32Array(barrier), 0, 2);
      const results = await Promise.all(finished);
      expect(results.map(result => result.kind).sort()).toEqual(['confirmed', 'conflict']);
      expect(await r.listConfirmations('scope-A')).toHaveLength(1);
    } finally {
      Atomics.store(new Int32Array(barrier), 0, 1);
      Atomics.notify(new Int32Array(barrier), 0, 2);
      await Promise.all(workers.map(worker => worker.terminate()));
    }
  }, 15000);
  it('트랜잭션 예외는 확정·head·멱등 참조를 전부 rollback한다', async () => {
    const r = open(), f = await fixture(r);
    const failure = new DatabaseSync(r.databasePath);
    failure.exec("CREATE TRIGGER synthetic_disk_failure BEFORE INSERT ON idempotent_command BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END;");
    failure.close();
    await expect(r.commitConfirmation('scope-A', { candidateId: f.candidateId, expectedRevision: 0, idempotencyKey: 'x' })).rejects.toThrow('synthetic disk failure');
    expect(await r.listConfirmations('scope-A')).toEqual([]);
    const raw = new DatabaseSync(r.databasePath);
    expect(raw.prepare('SELECT count(*) n FROM monthly_head').get()?.n).toBe(0);
    expect(raw.prepare('SELECT count(*) n FROM idempotent_command').get()?.n).toBe(0);
    raw.close();
    const repair = new DatabaseSync(r.databasePath);
    repair.exec('DROP TRIGGER synthetic_disk_failure');
    repair.close();
    expect(await r.commitConfirmation('scope-A', { candidateId: f.candidateId, expectedRevision: 0, idempotencyKey: 'x' })).toMatchObject({ revision: 1 });
  });
  it('재시작 후 동일 문서 복원·온라인 백업·별도 경로 복구와 권한', async () => {
    const r = open(), f = await fixture(r), first = await r.commitConfirmation('scope-A', { candidateId: f.candidateId, expectedRevision: 0, idempotencyKey: 'x' });
    if (first.kind !== 'confirmed')
      throw Error('not confirmed');
    const backup = await r.backup();
    expect(statSync(backup).mode & 0o777).toBe(0o600);
    expect(statSync(r.databasePath).mode & 0o777).toBe(0o600);
    r.close();
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1],{readOnly:true});const result={integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,body:db.prepare('SELECT body FROM report_document').get().body};console.log(JSON.stringify(result));db.close();`, r.databasePath], { encoding: 'utf8' });
    expect(child.status).toBe(0);
    const childResult = JSON.parse(child.stdout);
    expect(childResult.integrity).toBe('ok');
    expect(decodeEvidence(childResult.body)).toEqual(f.candidate.document);
    const restoreDir = mkdtempSync(join(tmpdir(), 'aifrm-restored-'));
    dirs.push(restoreDir);
    const restorePath = join(restoreDir, 'restored.sqlite');
    copyFileSync(backup, restorePath);
    const restarted = open(r.databasePath), restored = open(restorePath);
    expect((await restarted.getConfirmation('scope-A', first.confirmationId))?.document).toEqual(f.candidate.document);
    expect(await restored.getConfirmation('scope-A', first.confirmationId)).toEqual(await restarted.getConfirmation('scope-A', first.confirmationId));
    expect(await restored.defaultScopeId()).toBe(await restarted.defaultScopeId());
  });
  it('저장된 원본을 재작성/삭제하지 못하고 동일 내용 수신 기록은 각각 남는다', async () => {
    const r = open(), f = await fixture(r);
    const again = await r.putEvidence(f.evidence);
    expect(again.captureId).not.toBe(f.captureId);
    const raw = new DatabaseSync(r.databasePath);
    expect(() => raw.prepare('UPDATE source_capture SET body=? WHERE id=?').run('changed', f.captureId)).toThrow('IMMUTABLE_HISTORY');
    expect(() => raw.prepare('DELETE FROM report_candidate WHERE id=?').run(f.candidateId)).toThrow('IMMUTABLE_HISTORY');
    raw.close();
    expect(await r.getEvidence('scope-A', f.captureId)).toMatchObject(f.evidence);
    expect((await r.getInputSnapshot('scope-A', f.inputSnapshotId))?.inputHash).toBe(f.candidate.inputHash);
  });
  it('읽기 전용/손상/미지원 DB를 빈 DB나 성공으로 바꾸지 않는다', async () => {
    const r = open();
    const f = await fixture(r);
    const path = r.databasePath;
    r.close();
    const readonly = open(path, { readOnly: true });
    await expect(readonly.putEvidence(f.evidence)).rejects.toThrow();
    expect(await readonly.getCandidate('scope-A', f.candidateId)).not.toBeNull();
    const d = mkdtempSync(join(tmpdir(), 'aifrm-bad-'));
    dirs.push(d);
    const bad = join(d, 'bad.sqlite');
    writeFileSync(bad, 'broken');
    expect(() => open(bad)).toThrow();
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA user_version=99');
    raw.close();
    expect(() => open(path)).toThrow(/version|schema/i);
  });
  it('이력 선택은 cutoff·head와 canonical 현재 지표만 고정하며 재조회는 기존 선택을 바꾸지 않는다', async () => {
    const r = open(), f = await fixture(r);
    await r.commitConfirmation('scope-A', { candidateId: f.candidateId, expectedRevision: 0, idempotencyKey: 'x' });
    const selection = await r.createHistorySelection({ scopeId: 'scope-A', basis, calculationVersion: version, asOf: now, selectedBackfillBatchId: null });
    expect(selection.historyCalculationIds).toEqual([f.construction, f.funding]);
    await fixture(r, 'scope-A', 'later');
    expect(await r.getHistorySelection('scope-A', selection.historySelectionId)).toEqual(selection);
    expect(await r.listCalculations({ scopeId: 'scope-A', indicator: 'construction', from: month, to: month, calculationVersion: version, asOf: '2026-01-01T00:00:00Z', selectedBackfillBatchId: null })).toEqual([]);
  });
  it('batch 재개·요청 충돌·step 멱등·lease 회수의 fencing을 보장한다', async () => {
    const r = open(), f = await fixture(r);
    const request = { scopeId: 'scope-A', startKey: 'start', fromCycle: month, toCycle: month, inputHash: 'input-first', roundEntriesJson: [], fixedNow: now, evaluationTimeZone: 'Asia/Seoul', evaluatedCalendar: { year: 2026, month: 10, day: 23 } };
    const { batchId } = await r.putBatch(request);
    expect(await r.putBatch(request)).toEqual({ batchId });
    expect(await r.putBatch({ ...request, fixedNow: '2026-10-24T00:00:00.000Z', evaluatedCalendar: { year: 2026, month: 10, day: 24 } })).toEqual({ batchId });
    expect((await r.getBatch('scope-A', batchId))?.fixedNow).toBe(now);
    await expect(r.putBatch({ ...request, inputHash: 'other' })).rejects.toThrow();
    const claim = { scopeId: 'scope-A', batchId, sourceKey: 'ecos', ownerId: 'one', now, leaseUntil: '2026-10-23T00:01:30.000Z' };
    const one = await r.claimCaptureSlot(claim);
    expect(one.kind).toBe('claimed');
    expect((await r.claimCaptureSlot({ ...claim, ownerId: 'two' })).kind).toBe('busy');
    const two = await r.claimCaptureSlot({ ...claim, ownerId: 'two', now: '2026-10-23T00:01:31.000Z', leaseUntil: '2026-10-23T00:03:01.000Z' });
    if (one.kind !== 'claimed' || two.kind !== 'claimed')
      throw Error('claim');
    expect(two.fence).toBeGreaterThan(one.fence);
    expect(await r.completeCaptureSlot({ ...claim, fence: one.fence, evidence: f.evidence })).toEqual({ kind: 'stale' });
    expect(await r.completeCaptureSlot({ ...claim, ownerId: 'two', fence: two.fence, evidence: f.evidence })).toMatchObject({ kind: 'saved' });
    expect((await r.claimCaptureSlot(claim)).kind).toBe('ready');
    const batchConstruction = (await r.putCalculation({ ...f.common, indicator: 'construction', origin: 'reconstructed', batchId })).calculationId;
    const batchFunding = (await r.putCalculation({ ...f.common, indicator: 'funding', origin: 'reconstructed', effectiveMonth: basis.fundingObservedMonth, inputHash: 'judged-first', batchId })).calculationId;
    const step = { scopeId: 'scope-A', batchId, reportCycle: month, basis, calculationIds: { construction: batchConstruction, funding: batchFunding } };
    await expect(r.commitBatchStep({ ...step, basis: { ...basis, fundingObservedMonth: month } })).rejects.toThrow('BATCH_BASIS_MISMATCH');
    const wrongFunding = (await r.putCalculation({ ...f.common, indicator: 'funding', origin: 'reconstructed', effectiveMonth: month, inputHash: 'judged-first', batchId })).calculationId;
    await expect(r.commitBatchStep({ ...step, calculationIds: { ...step.calculationIds, funding: wrongFunding } })).rejects.toThrow('BATCH_CALCULATION_MISMATCH');
    const completed = await r.commitBatchStep(step);
    expect(completed.status).toBe('completed');
    expect(await r.commitBatchStep(step)).toEqual(completed);
    expect(await r.listBatches('scope-A', 'active', 10)).toEqual([]);
    const selection = await r.createHistorySelection({ scopeId: 'scope-A', basis, calculationVersion: version, asOf: now, selectedBackfillBatchId: batchId });
    expect(selection.historyCalculationIds).toEqual([batchConstruction, batchFunding]);
    await expect(r.createHistorySelection({ scopeId: 'scope-B', basis, calculationVersion: version, asOf: now, selectedBackfillBatchId: batchId })).rejects.toThrow();
  });
  it('선택 이력은 지표별 실제 anchor 이전 17개월까지만 포함한다', async () => {
    const r = open();
    const f = await fixture(r);
    const old = yearMonth(2025, 1);
    const { batchId } = await r.putBatch({ scopeId: 'scope-A', startKey: 'old', fromCycle: old, toCycle: old, inputHash: 'full-batch', roundEntriesJson: [], fixedNow: now, evaluationTimeZone: 'Asia/Seoul', evaluatedCalendar: { year: 2026, month: 10, day: 23 } });
    const oldBasis: ReportBasis = { reportCycle: old, reportTitleMonth: yearMonth(2024, 12), constructionBaseMonth: yearMonth(2024, 11), fundingJudgedMonth: old, fundingObservedMonth: yearMonth(2024, 12), gapMonth: old };
    const construction = (await r.putCalculation({ ...f.common, indicator: 'construction', origin: 'reconstructed', effectiveMonth: oldBasis.constructionBaseMonth, batchId })).calculationId;
    const funding = (await r.putCalculation({ ...f.common, indicator: 'funding', origin: 'reconstructed', effectiveMonth: oldBasis.fundingObservedMonth, inputHash: 'judged-old', batchId })).calculationId;
    await r.commitBatchStep({ scopeId: 'scope-A', batchId, reportCycle: old, basis: oldBasis, calculationIds: { construction, funding } });
    const selection = await r.createHistorySelection({ scopeId: 'scope-A', basis, calculationVersion: version, asOf: now, selectedBackfillBatchId: batchId });
    expect(selection.historyCalculationIds).toEqual([]);
    expect(selection.headRevisions).toEqual([]);
  });
  it('18개월 밖 확정 head는 선택 내용과 revision 토큰에서 제외한다', async () => {
    const r = open();
    const old = yearMonth(2025, 1);
    const oldBasis: ReportBasis = { reportCycle: old, reportTitleMonth: yearMonth(2024, 12), constructionBaseMonth: yearMonth(2024, 11), fundingJudgedMonth: old, fundingObservedMonth: yearMonth(2024, 12), gapMonth: old };
    const f = await fixture(r, 'scope-A', 'old-head', oldBasis);
    expect(await r.commitConfirmation('scope-A', { candidateId: f.candidateId, expectedRevision: 0, idempotencyKey: 'old-head' })).toMatchObject({ revision: 1 });
    const selection = await r.createHistorySelection({ scopeId: 'scope-A', basis, calculationVersion: version, asOf: now, selectedBackfillBatchId: null });
    expect(selection.historyCalculationIds).toEqual([]);
    expect(selection.headRevisions).toEqual([]);
  });
});
