import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, statSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { decodeEvidence, encodeEvidence, evidenceToJson } from './evidence-codec';
import { SqliteHistoryRepository, hashHistoryValue } from './sqlite-history-repository';
import { historyWorkbookCodec } from './history-workbook';
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
  const common: Omit<CalculationWrite, 'indicator'> = { scopeId, origin: 'live', derivation: { kind: 'captured' }, effectiveMonth: candidateBasis.constructionBaseMonth, requestContext: { basis: candidateBasis.reportCycle }, inputHash: 'ledger-' + tag, calculationVersion: version, captureIds: [captureId], resultJson: evidenceToJson({ ok:false, reason:'합성 결과' }), evaluatedAt: now, evaluationClockTrace: [now, '2026-10-23T00:00:00.001Z'], evaluatedCalendar: { year: 2026, month: 10, day: 23 }, evaluationTimeZone: 'Asia/Seoul', createdAt: now };
  const construction = (await r.putCalculation({ ...common, indicator: 'construction' })).calculationId;
  const funding = (await r.putCalculation({ ...common, indicator: 'funding', effectiveMonth: candidateBasis.fundingObservedMonth, inputHash: 'judged-' + tag })).calculationId;
  const selection = await r.createHistorySelection({ scopeId, basis: candidateBasis, calculationVersion: version, asOf: now, selectedBackfillBatchId: null });
  const candidate: CandidateWrite = { scopeId, basis: candidateBasis, inputSnapshotId, inputHash: 'input-' + tag, calculationInputHashes: { construction: 'ledger-' + tag, funding: 'judged-' + tag }, calculationVersion: version, authoredAt: now, preparedAt: now, calculationIds: { construction, funding }, historySelectionId: selection.historySelectionId, document: { schemaVersion: 1, templateVersion: 'report@e3a8f9e', contentHash: 'doc-' + tag, json: { synthetic: tag, value: 0.1234567890123456 }, historyCalculationIds: selection.historyCalculationIds }, correctionPreviewId: null };
  const { candidateId } = await r.putCandidate(candidate);
  return { candidateId, candidate, captureId, inputSnapshotId, construction, funding, common, evidence };
}
async function seedDerivationImport(r: SqliteHistoryRepository, f: Awaited<ReturnType<typeof fixture>>, importId: string, patchHash: string) {
  const scopeId=f.candidate.scopeId;
  const confirmed=await r.commitConfirmation(scopeId,{candidateId:f.candidateId,expectedRevision:0,idempotencyKey:'seed-'+importId});
  if(confirmed.kind!=='confirmed'&&confirmed.kind!=='already-confirmed')throw Error('seed failed');
  const draft={scopeId,exportId:'export-'+importId,workbookFormatVersion:1 as const,baseConfirmationId:confirmed.confirmationId,baseRevision:confirmed.revision,baseDocumentHash:f.candidate.document.contentHash,basis:f.candidate.basis,inputSnapshotId:f.inputSnapshotId,inputHash:f.candidate.inputHash,calculationIds:f.candidate.calculationIds,historySelectionId:f.candidate.historySelectionId,calculationVersion:version,templateVersion:'report@e3a8f9e',createdAt:now,rows:[],history:[],result:[]};
  await r.putWorkbookExport({...draft,structure:historyWorkbookCodec.structure(draft)});
  const imported={scopeId,importId,exportId:draft.exportId,fileHash:'synthetic',patchHash,patch:[{rowId:'synthetic',action:'set',value:1,reason:'합성 정정',evidenceNote:''}],status:'validated',errors:[],receivedAt:now};
  const db=new DatabaseSync(r.databasePath);db.prepare('INSERT INTO workbook_import VALUES(?,?,?,?,?)').run(scopeId,importId,draft.exportId,patchHash,encodeEvidence(imported));db.close();
}
describe('SQLite 불변 월별 이력', () => {
  it('migration2는 명세를 scope별 불변 저장한다', async () => {
    const r = open();
    const scopeId = await r.defaultScopeId();
    const database = new DatabaseSync(r.databasePath, { readOnly: true });
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(4);
    database.close();
    const draft = { scopeId, exportId: 'export-1', workbookFormatVersion: 1 as const, baseConfirmationId: 'base-1', baseRevision: 1,
      baseDocumentHash: 'hash', basis, inputSnapshotId: 'input-1', inputHash: 'input-hash', calculationIds: { construction: 'c', funding: 'f' },
      historySelectionId: 'selection-1', calculationVersion: version, templateVersion: 'report@e3a8f9e', createdAt: now, rows: [], history: [], result: { synthetic: true } };
    const manifest = { ...draft, structure: historyWorkbookCodec.structure(draft) };
    await expect(r.putWorkbookExport(manifest)).rejects.toThrow('NOT_FOUND_OR_WRONG_SCOPE');
    const f = await fixture(r, scopeId);
    const confirmed = await r.commitConfirmation(scopeId, { candidateId: f.candidateId, expectedRevision: 0, idempotencyKey: 'export-fixture' });
    if (confirmed.kind !== 'confirmed') throw Error('fixture confirmation failed');
    const valid = { ...manifest, baseConfirmationId: confirmed.confirmationId, baseRevision: confirmed.revision,
      baseDocumentHash: f.candidate.document.contentHash, inputSnapshotId: f.inputSnapshotId, inputHash: f.candidate.inputHash,
      calculationIds: f.candidate.calculationIds, historySelectionId: f.candidate.historySelectionId };
    expect(await r.putWorkbookExport(valid)).toEqual(valid);
    expect(await r.getWorkbookExport('other-scope', valid.exportId)).toBeNull();
    const raw = new DatabaseSync(r.databasePath);
    expect(() => raw.prepare('UPDATE workbook_export SET body=? WHERE id=?').run('tampered', valid.exportId)).toThrow('IMMUTABLE_HISTORY');
    raw.close();
  }, 15_000);
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
    await seedDerivationImport(r,f,'synthetic-import','patch');
    const derived = await r.putCalculation({ ...f.common, indicator: 'construction', origin: 'live', derivation: { kind: 'manual-correction', parentId: f.construction, importId: 'synthetic-import', patchHash: 'patch', correctedAt: now } });
    expect((await r.getCalculation('scope-A', derived.calculationId))?.derivation).toMatchObject({ parentId: f.construction });
    await expect(r.putCalculation({ ...f.common, indicator: 'construction', origin: 'reconstructed', derivation: { kind: 'manual-correction', parentId: f.construction, importId: 'i', patchHash: 'p', correctedAt: now } })).rejects.toThrow();
  });
  it('이력 조회는 사용자 지정 건설 기준월과 Gap 월을 보존하되 확정 정책은 그대로 유지한다', async () => {
    const r = open();
    await fixture(r);
    const custom = { ...basis, constructionBaseMonth: yearMonth(2026, 6), gapMonth: yearMonth(2026, 8) };
    const selection = await r.createHistorySelection({ scopeId: 'scope-A', basis: custom, calculationVersion: version, asOf: now, selectedBackfillBatchId: null });
    expect(selection.anchors).toEqual({ construction: custom.constructionBaseMonth, funding: basis.fundingObservedMonth });
    expect(selection.historyCalculationIds).toEqual([]);
    await expect(r.putCandidate({ ...(await fixture(r, 'scope-A', 'another')).candidate, basis: custom })).rejects.toThrow('INVALID_BASIS');
  });
  it('정정 입력은 부모 Statement 순서·기준일·월 구조를 보존하고 금액만 바꿀 수 있다', async () => {
    const r = open();
    const first: StatementSnapshotDto = { asOf: { year: 2026, month: 8, day: 31 }, monthLabels: ['7월', '8월'], baseMonthIndex: 1, planYearEndIndex: 1, amounts: { 기초시재: [0, 1], 수입계: [2, 3], 수입: { unreadable: '합성 결측' }, 분양회수: [6, 7], 기타수입: [8, 9], 지출: [10, 11] } };
    const second: StatementSnapshotDto = { ...first, asOf: { year: 2026, month: 9, day: 30 } };
    const parent = await r.putInputSnapshot({ scopeId: 'scope-A', statements: [first, second], sourceMetadata: { file: 'synthetic' }, inputHash: 'parent', derivation: { kind: 'captured' }, createdAt: now });
    await seedDerivationImport(r,await fixture(r),'synthetic-import','patch');
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
    await seedDerivationImport(r,f,'i','p');
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
    const exportDraft = { scopeId: 'scope-A', exportId: 'backup-export-1', workbookFormatVersion: 1 as const,
      baseConfirmationId: first.confirmationId, baseRevision: first.revision, baseDocumentHash: f.candidate.document.contentHash,
      basis, inputSnapshotId: f.inputSnapshotId, inputHash: f.candidate.inputHash, calculationIds: f.candidate.calculationIds,
      historySelectionId: f.candidate.historySelectionId, calculationVersion: version, templateVersion: f.candidate.document.templateVersion,
      createdAt: now, rows: [], history: [], result: { synthetic: true } };
    const exportManifest = { ...exportDraft, structure: historyWorkbookCodec.structure(exportDraft) };
    await r.putWorkbookExport(exportManifest);
    const backup = await r.backup();
    expect(statSync(backup).mode & 0o777).toBe(0o600);
    expect(statSync(r.databasePath).mode & 0o777).toBe(0o600);
    r.close();
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1],{readOnly:true});const result={integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,body:db.prepare('SELECT body FROM report_document').get().body};console.log(JSON.stringify(result));db.close();`, r.databasePath], { encoding: 'utf8' });
    expect(child.status, child.stderr).toBe(0);
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
    expect(await restored.getWorkbookExport('scope-A', exportManifest.exportId)).toEqual(exportManifest);
    expect(await restored.defaultScopeId()).toBe(await restarted.defaultScopeId());
  });
  it('백업 완료가 마지막 active 요청이어도 자식 프로세스가 정상 종료한다', () => {
    const folder = mkdtempSync(join(tmpdir(), 'aifrm-last-backup-'));
    dirs.push(folder);
    const source = join(folder, 'source.sqlite'), destination = join(folder, 'backup.sqlite');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const { backupWithWake } = await import(process.argv[3]);
      const seed = new DatabaseSync(process.argv[1]);
      seed.exec("PRAGMA journal_mode=WAL; CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('saved')");
      seed.close();
      const db = new DatabaseSync(process.argv[1], { readOnly: true });
      const guard = setTimeout(() => { console.log('TIMEOUT_RED'); process.exit(2); }, 1500);
      backupWithWake(db, process.argv[2]).then(() => {
        db.close(); clearTimeout(guard); console.log('BACKUP_COMPLETE');
      }).catch(error => { clearTimeout(guard); console.error(error); process.exitCode = 1; });
    `, source, destination, pathToFileURL(join(process.cwd(), 'src/infrastructure/report-history/sqlite-backup-wake.mjs')).href], { encoding: 'utf8', timeout: 3000 });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain('BACKUP_COMPLETE');
    const restored = new DatabaseSync(destination, { readOnly: true });
    expect(restored.prepare('SELECT value FROM sample').get()?.value).toBe('saved');
    restored.close();
  }, 5000);
  it('백업 실패 후에도 wake timer를 남기지 않는다', () => {
    const folder = mkdtempSync(join(tmpdir(), 'aifrm-failed-backup-'));
    dirs.push(folder);
    const source = join(folder, 'source.sqlite'), destination = join(folder, 'absent', 'backup.sqlite');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const { backupWithWake } = await import(process.argv[3]);
      const db = new DatabaseSync(process.argv[1]);
      db.exec('CREATE TABLE sample(value TEXT)');
      try { await backupWithWake(db, process.argv[2]); process.exitCode = 2; }
      catch { console.log('BACKUP_REJECTED'); }
      finally { db.close(); }
    `, source, destination, pathToFileURL(join(process.cwd(), 'src/infrastructure/report-history/sqlite-backup-wake.mjs')).href], { encoding: 'utf8', timeout: 3000 });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain('BACKUP_REJECTED');
  }, 5000);
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

async function correctionFixture(options: { unreadable?: boolean; noFetchedAt?: boolean; future?: boolean; history?: boolean } = {}) {
  const [{ captureConstruction, captureFunding }, { prepareReportCandidate, restoreStatement }, { ledgerOf }, { roundEntryOf }, codec, sources, correction] = await Promise.all([
    import('../../application/report-history/report-history'), import('../../application/report-history/report-candidate'), import('../../domain/cashflow/forecast-ledger'), import('../../domain/cashflow/round-entry'), import('./evidence-codec'), import('./captured-sources'), import('../../application/report-history/report-correction'),
  ]);
  const r = open(), scopeId = await r.defaultScopeId();
  const source = Object.fromEntries((await import('../../domain/risk/construction-perception/policy')).SCORING_RULES.filter(rule=>rule.key !== '분양회수예측오차').map(rule=>[rule.key,{ unit:'지수', values:new Map([[yearMonth(2026,7),110],[yearMonth(2026,6),100],[yearMonth(2025,7),100]]), ...(options.noFetchedAt ? {} : {fetchedAt:new Date(now)}) }])) as never;
  let calls = 0;
  const deps = { repository:r, indicators:{fetchAll:async()=>source}, yields:{dailyYields:async()=>({days:[{date:'2026/08/31',publicAaa:{average:3.674,byAgency:{A:99}},treasury:{average:2.5,byAgency:{A:99}}}],fetchedAt:new Date(now)})},
    clock:(()=>{let tick=0;return ()=>new Date((options.future?'2026-07-01T00:00:00.000Z':tick++===0?now:'2026-10-23T00:00:00.001Z'));})(),metadataClock:()=>new Date('2026-11-01T01:00:00.000Z'),hash:hashHistoryValue,encode:codec.evidenceToJson,decode:codec.evidenceFromJson,calculationVersion:version,
    captureIndicators:sources.captureEconomicSource,captureYields:sources.captureBondSource,replayIndicators:sources.replayEconomicSource,replayYields:sources.replayBondSource,isUnsafe:sources.containsSourceCredentials,
    nextId:()=>crypto.randomUUID(),workbookCodec:historyWorkbookCodec,ecosCatalog:[],
    documentFactory: (input: import('../../application/report-history/report-candidate').RestoredReportInput, selection: import('../../application/report-history/ports').ExternalHistorySelection) => {
      const json = codec.evidenceToJson({ dashboard:input.dashboard,construction:input.constructionOutcome,funding:input.fundingOutcome,authoredAt:input.authoredAt });
      return { schemaVersion:1 as const,templateVersion:'report@e3a8f9e',contentHash:hashHistoryValue(json),json,historyCalculationIds:selection.historyCalculationIds };
    },
  } as unknown as import('../../application/report-history/ports').ReportCorrectionDependencies;
  const statements = [6,8,9].map(month=>({asOf:{year:2026,month,day:28},monthLabels:Array.from({length:12},(_,i)=>`${i+1}월`),baseMonthIndex:month-1,planYearEndIndex:11,amounts:{기초시재:Array(12).fill(100),수입계:Array(12).fill(50),수입:Array(12).fill(40),분양회수:Array(12).fill(30),기타수입:Array(12).fill(10),지출:Array(12).fill(60)}}));
  if(options.unreadable)(statements[0].amounts as unknown as Record<string,unknown>).수입={unreadable:'합성 판독 불가'};
  const ledger = ledgerOf(statements.map(restoreStatement).map(roundEntryOf));
  const c = await captureConstruction(deps,scopeId,{reportMonth:basis.reportCycle},ledger), f = await captureFunding(deps,scopeId,{judgedMonth:basis.fundingJudgedMonth});
  if(c.history.captureStatus!=='saved'||f.history.captureStatus!=='saved') throw Error('fixture failed');
  if(options.history) {
    const priorBasis={reportCycle:yearMonth(2026,8),reportTitleMonth:yearMonth(2026,7),constructionBaseMonth:yearMonth(2026,6),fundingJudgedMonth:yearMonth(2026,8),fundingObservedMonth:yearMonth(2026,7),gapMonth:yearMonth(2026,8)};
    const prior=await fixture(r,scopeId,'history',priorBasis);await r.commitConfirmation(scopeId,{candidateId:prior.candidateId,expectedRevision:0,idempotencyKey:'history'});
  }
  const selection = await r.createHistorySelection({scopeId,basis,calculationVersion:version,asOf:now,selectedBackfillBatchId:null});
  const documentFactory = (deps as unknown as {documentFactory:import('../../application/report-history/report-candidate').ReportDocumentFactory}).documentFactory;
  const candidate = await prepareReportCandidate(deps,{scopeId,basis,statements,sourceMetadata:{files:['synthetic-june','synthetic-aug','synthetic-sept']},constructionCalculationId:c.history.calculationId,fundingCalculationId:f.history.calculationId,historySelectionId:selection.historySelectionId,authoredAt:now,inputGeneration:'fixture'},documentFactory);
  const confirmed = await r.commitConfirmation(scopeId,{candidateId:candidate.candidateId,expectedRevision:0,idempotencyKey:'fixture'});
  if(confirmed.kind!=='confirmed') throw Error('fixture failed');
  const manifest = await correction.exportCorrectionWorkbook(deps,scopeId,confirmed.confirmationId);
  const disabled = {...deps,indicators:{fetchAll:async()=>{calls++;throw Error('LIVE_CALL');}},yields:{dailyYields:async()=>{calls++;throw Error('LIVE_CALL');}}};
  const validate = (correction as unknown as {validateCorrectionWorkbook?: (d:typeof deps,s:string,b:Uint8Array)=>Promise<unknown>}).validateCorrectionWorkbook;
  const edit = async (kind: 'cash'|'kofia'|'same'|'bad') => {
    const X = await import('xlsx'); const b = X.read(historyWorkbookCodec.encode(manifest),{type:'array'});
    const sheet = b.Sheets[kind==='kofia'?'조달금리_정정':'자금자료_정정'];
    sheet.G2={t:'s',v:'값수정'};sheet.H2={t:'n',v:kind==='same'?100:kind==='kofia'?3.7:0};sheet.I2={t:'s',v:'합성 정정'};
    if(kind==='bad')sheet.D2={t:'s',v:'원'};
    return new Uint8Array(X.write(b,{type:'array',bookType:'xlsx',compression:true}));
  };
  const counts = () => { const db = new DatabaseSync(r.databasePath); const result = Object.fromEntries(['source_capture','report_input_snapshot','calculation_record','report_candidate','correction_preview','monthly_confirmation','monthly_head'].map(table=>[table,Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n)])); db.close(); return result; };
  return {r,scopeId,deps:disabled,manifest,validate,edit,counts,calls:()=>calls,confirmed,candidate,statements,correction};
}
it('import_unchanged_is_noop: 원장 파생 레코드·확정 head가 전혀 늘지 않는다',async()=>{
  const f=await correctionFixture(), before=f.counts();
  const result=await f.validate?.(f.deps,f.scopeId,await f.edit('same'));
  expect(result).toMatchObject({kind:'no-change',baseConfirmationId:f.confirmed.confirmationId});
  expect(f.counts()).toEqual(before); expect(f.calls()).toBe(0);
});
it('correction_commits_one_revision: 저장된 preview만 한 회차를 새 revision으로 확정하고 원본을 보존한다',async()=>{
  const f=await correctionFixture(),old=await f.r.getConfirmation(f.scopeId,f.confirmed.confirmationId);
  const result=await f.validate!(f.deps,f.scopeId,await f.edit('cash')) as {previewId:string;previewHash:string};
  const preview=await f.r.getCorrectionPreview(f.scopeId,result.previewId);
  const command={previewId:result.previewId,previewHash:preview!.previewHash,expectedBaseRevision:1,idempotencyKey:'correction-1',reason:'합성 원자료 정정'};
  expect(f.counts().monthly_confirmation).toBe(1);
  const saved=await f.r.commitCorrection(f.scopeId,command);
  expect(saved).toMatchObject({kind:'confirmed',revision:2});
  if(saved.kind!=='confirmed') throw Error('expected confirmation');
  const current=await f.r.getConfirmation(f.scopeId,saved.confirmationId);
  expect(current).toMatchObject({previousConfirmationId:f.confirmed.confirmationId,candidateId:preview!.candidateId,correctionReason:command.reason});
  expect(await f.r.getConfirmation(f.scopeId,f.confirmed.confirmationId)).toEqual(old);
  expect((await f.r.getCandidate(f.scopeId,preview!.candidateId))?.authoredAt).toBe(preview!.createdAt);
  expect(current?.confirmedAt).not.toBe(preview!.createdAt);
  expect(f.calls()).toBe(0);
});
it('correction_cas_and_idempotency: 다른 키 재시도는 기존 ID이고 변조·재사용·stale은 쓰기 없이 충돌한다',async()=>{
  const f=await correctionFixture({history:true}),validated=await f.validate!(f.deps,f.scopeId,await f.edit('cash')) as {previewId:string;previewHash:string};
  const cmd={previewId:validated.previewId,previewHash:validated.previewHash,expectedBaseRevision:1,idempotencyKey:'same',reason:'합성 정정'};
  const initial=await f.r.commitCorrection(f.scopeId,cmd);
  expect(initial.kind).toBe('confirmed');
  if(initial.kind!=='confirmed') throw Error('expected confirmation');
  const before=f.counts();
  expect(await f.r.commitCorrection(f.scopeId,cmd)).toMatchObject({kind:'already-confirmed',confirmationId:initial.confirmationId});
  expect(await f.r.commitCorrection(f.scopeId,{...cmd,idempotencyKey:'other'})).toMatchObject({kind:'already-confirmed',confirmationId:initial.confirmationId});
  expect(await f.r.commitConfirmation(f.scopeId,{candidateId:f.candidate.candidateId,expectedRevision:1,idempotencyKey:'other'})).toMatchObject({kind:'conflict',reason:'IDEMPOTENCY_KEY_REUSED'});
  expect(await f.r.commitCorrection(f.scopeId,{...cmd,previewHash:'tampered',idempotencyKey:'tampered'})).toMatchObject({kind:'conflict'});
  expect(await f.r.commitCorrection(f.scopeId,{...cmd,reason:'다른 사유'})).toMatchObject({kind:'conflict',reason:'IDEMPOTENCY_KEY_REUSED'});
  expect(await f.r.commitConfirmation(f.scopeId,{candidateId:(await f.r.getCorrectionPreview(f.scopeId,cmd.previewId))!.candidateId,expectedRevision:1,idempotencyKey:'bypass'})).toMatchObject({kind:'not-ready',reason:'CORRECTION_PREVIEW_REQUIRED'});
  expect(f.counts()).toEqual(before);
});
it('두 탭에서 이전 preview와 의존 head 변경은 409이고 확정된 preview 재시도는 최신 head를 되돌리지 않는다',async()=>{
  const f=await correctionFixture({history:true}),bytes=await f.edit('cash'),validated=await f.validate!(f.deps,f.scopeId,bytes) as {previewId:string;previewHash:string};
  const cmd={previewId:validated.previewId,previewHash:validated.previewHash,expectedBaseRevision:1,idempotencyKey:'tab-one',reason:'합성 정정'};
  const other=open(f.r.databasePath),first=await other.commitCorrection(f.scopeId,cmd);
  expect(first).toMatchObject({kind:'confirmed',revision:2});
  if(first.kind!=='confirmed') throw Error('expected confirmation');
  const prior=(await f.r.listConfirmations(f.scopeId)).find(item=>item.reportCycle==='2026/08')!;
  const priorCandidate=await f.r.getCandidate(f.scopeId,prior.candidateId),next=await f.r.putCandidate({...priorCandidate!,document:{...priorCandidate!.document,contentHash:'changed-prior'}});
  await f.r.commitConfirmation(f.scopeId,{candidateId:next.candidateId,expectedRevision:1,idempotencyKey:'dependency-change',correctionReason:'합성 이력 변경'});
  const before=f.counts();
  expect(await f.r.commitCorrection(f.scopeId,{...cmd,idempotencyKey:'tab-two'})).toMatchObject({kind:'already-confirmed',confirmationId:first.confirmationId});
  expect(f.counts()).toEqual(before);
  const newerExport=await f.correction.exportCorrectionWorkbook(f.deps,f.scopeId,first.confirmationId);
  expect(newerExport.exportId).not.toBe(f.manifest.exportId);
  await expect(f.validate!(f.deps,f.scopeId,bytes)).rejects.toMatchObject({code:'STALE_BASE'});
});
it('확정 전에 참조 head가 바뀌면 정정 명령은 STALE_DEPENDENCY로 충돌하고 쓰지 않는다',async()=>{
  const f=await correctionFixture({history:true}),validated=await f.validate!(f.deps,f.scopeId,await f.edit('cash')) as {previewId:string;previewHash:string};
  const prior=(await f.r.listConfirmations(f.scopeId)).find(item=>item.reportCycle==='2026/08')!;
  const old=await f.r.getCandidate(f.scopeId,prior.candidateId),next=await f.r.putCandidate({...old!,document:{...old!.document,contentHash:'changed-dependency'}});
  const other=open(f.r.databasePath);await other.commitConfirmation(f.scopeId,{candidateId:next.candidateId,expectedRevision:1,idempotencyKey:'prior-change',correctionReason:'합성 변경'});
  const before=f.counts();
  expect(await f.r.commitCorrection(f.scopeId,{previewId:validated.previewId,previewHash:validated.previewHash,expectedBaseRevision:1,idempotencyKey:'stale',reason:'합성 정정'})).toMatchObject({kind:'conflict',reason:'STALE_DEPENDENCY'});
  expect(f.counts()).toEqual(before);
});
it('동일 기준본의 서로 다른 두 탭 preview 중 처음 확정한 것만 채택한다',async()=>{
  const f=await correctionFixture(),cash=await f.validate!(f.deps,f.scopeId,await f.edit('cash')) as {previewId:string;previewHash:string};
  const kofia=await f.validate!(f.deps,f.scopeId,await f.edit('kofia')) as {previewId:string;previewHash:string};
  const other=open(f.r.databasePath);
  expect(await other.commitCorrection(f.scopeId,{previewId:cash.previewId,previewHash:cash.previewHash,expectedBaseRevision:1,idempotencyKey:'tab-a',reason:'자금 수정'})).toMatchObject({kind:'confirmed',revision:2});
  const before=f.counts();
  expect(await f.r.commitCorrection(f.scopeId,{previewId:kofia.previewId,previewHash:kofia.previewHash,expectedBaseRevision:1,idempotencyKey:'tab-b',reason:'채권 수정'})).toMatchObject({kind:'conflict',reason:'STALE_BASE'});
  expect(f.counts()).toEqual(before);
  expect((await f.r.listConfirmations(f.scopeId,basis.reportCycle)).map(item=>item.revision)).toEqual([1,2]);
});
it('존재하지 않는 정정 미리보기는 저장 없이 NOT_FOUND로 구분한다',async()=>{
  const r=open();const scopeId=await r.defaultScopeId();
  await expect(r.commitCorrection(scopeId,{previewId:'00000000-0000-4000-8000-000000000000',previewHash:'a'.repeat(64),expectedBaseRevision:1,idempotencyKey:'missing',reason:'합성 정정'})).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(await r.listConfirmations(scopeId)).toEqual([]);
});
it('correction_atomic_after_restart: head와 멱등 INSERT 실패는 모두 rollback하고 미확정 preview는 재시작 뒤 클릭에서만 확정한다',async()=>{
  const f=await correctionFixture(),validated=await f.validate!(f.deps,f.scopeId,await f.edit('cash')) as {previewId:string;previewHash:string};
  const command={previewId:validated.previewId,previewHash:validated.previewHash,expectedBaseRevision:1,idempotencyKey:'restart',reason:'합성 정정'};
  const before=f.counts();
  for(const table of ['monthly_confirmation','monthly_head','idempotent_command','correction_command']){
    const db=new DatabaseSync(f.r.databasePath);db.exec(`CREATE TRIGGER fail_correction BEFORE ${table==='monthly_head'?'UPDATE':'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT,'SYNTHETIC_DISK_FAILURE'); END;`);
    await expect(f.r.commitCorrection(f.scopeId,command)).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'});
    expect(f.counts()).toEqual(before);db.exec('DROP TRIGGER fail_correction');db.close();
  }
  const restarted=open(f.r.databasePath);
  expect(await restarted.getCorrectionPreview(f.scopeId,validated.previewId)).toMatchObject({previewHash:validated.previewHash});
  expect(f.counts()).toEqual(before);
  expect(await restarted.commitCorrection(f.scopeId,command)).toMatchObject({kind:'confirmed',revision:2});
  expect(f.calls()).toBe(0);
});
it('head UPDATE가 trigger에 의해 조용히 무시되면 confirmation과 idempotency도 남기지 않는다',async()=>{
  const f=await correctionFixture(),validated=await f.validate!(f.deps,f.scopeId,await f.edit('cash')) as {previewId:string;previewHash:string};
  const before=f.counts(),db=new DatabaseSync(f.r.databasePath);
  db.exec('CREATE TRIGGER ignore_head BEFORE UPDATE ON monthly_head BEGIN SELECT RAISE(IGNORE); END;');
  await expect(f.r.commitCorrection(f.scopeId,{previewId:validated.previewId,previewHash:validated.previewHash,expectedBaseRevision:1,idempotencyKey:'ignore-head',reason:'합성 정정'})).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'});
  expect(f.counts()).toEqual(before);
  db.exec('DROP TRIGGER ignore_head');db.close();
});
it('recalculate_from_complete_input: 검증 성공도 확정 head 불변이며 원래 시계·입력에서 다섯 결과를 복원한다',async()=>{
  const f=await correctionFixture(),before=f.counts();
  const result=await f.validate?.(f.deps,f.scopeId,await f.edit('cash')) as {kind:string;previewId:string};
  expect(result?.kind).toBe('preview');
  const preview=await (f.r as unknown as {getCorrectionPreview:(s:string,id:string)=>Promise<import('../../application/report-history/ports').JsonValue>}).getCorrectionPreview(f.scopeId,result.previewId) as unknown as {candidateId:string;rawDiff:unknown[]};
  const c=await f.r.getCandidate(f.scopeId,preview.candidateId); const input=await f.r.getInputSnapshot(f.scopeId,c!.inputSnapshotId);
  expect((input?.statements[0].amounts.기초시재 as readonly number[])[0]).toBe(0); expect(input?.statements[0].amounts.수입계).toEqual(Array(12).fill(50));
  expect(preview.rawDiff).toHaveLength(1); expect(f.counts().monthly_head).toBe(before.monthly_head);expect(f.counts().monthly_confirmation).toBe(before.monthly_confirmation);expect(f.calls()).toBe(0);
  const original=await f.r.getCalculation(f.scopeId,f.manifest.calculationIds.funding),derived=await f.r.getCalculation(f.scopeId,c!.calculationIds.funding);
  expect(derived?.resultJson).toEqual(original?.resultJson);expect(derived?.evaluationClockTrace).toEqual(original?.evaluationClockTrace);
});

it('stageCorrection는 모든 저장 단계 실패를 rollback하고 동일 수정안을 두 연결에서 한 번만 게시한다',async()=>{
  const f=await correctionFixture(),bytes=await f.edit('kofia'),before=f.counts();
  for(const table of ['workbook_import','source_capture','report_input_snapshot','calculation_record','correction_preview','report_document','report_candidate']) {
    const db=new DatabaseSync(f.r.databasePath);db.exec(`CREATE TRIGGER fail_stage BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'SYNTHETIC_STAGE_FAILURE'); END;`);
    await expect(f.validate!(f.deps,f.scopeId,table==='report_input_snapshot'?await f.edit('cash'):bytes)).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'});
    expect(f.counts()).toEqual(before);db.exec('DROP TRIGGER fail_stage');db.close();
  }
  const other=open(f.r.databasePath);
  const [a,b]=await Promise.all([f.validate!(f.deps,f.scopeId,bytes),f.validate!({...f.deps,repository:other},f.scopeId,bytes)]);
  expect(a).toEqual(b);expect(a).toMatchObject({kind:'preview'});expect(f.counts().correction_preview).toBe(1);
  const restarted=open(f.r.databasePath);expect(await restarted.getCorrectionPreview(f.scopeId,(a as {previewId:string}).previewId)).toMatchObject({baseRevision:1,rawDiff:[{before:3.674,after:3.7}]});
  expect(f.counts().monthly_confirmation).toBe(before.monthly_confirmation);
});
it('stage 직전 다른 연결이 기준 head를 바꾸면 파생 기록 0으로 409 코드가 보존된다',async()=>{
  const f=await correctionFixture(),other=open(f.r.databasePath),before=f.counts();
  const candidate=await other.getCandidate(f.scopeId,f.candidate.candidateId);const next=await other.putCandidate({...candidate!,document:{...candidate!.document,contentHash:'synthetic-head-change'}});
  const counts=f.counts();
  const wrapped=new Proxy(f.r,{get(target,key){if(key==='stageCorrection')return async(input:import('../../application/report-history/ports').CorrectionStageWrite)=>{await other.commitConfirmation(f.scopeId,{candidateId:next.candidateId,expectedRevision:1,idempotencyKey:'other-tab',correctionReason:'합성 변경'});return target.stageCorrection(input);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  await expect(f.validate!({...f.deps,repository:wrapped},f.scopeId,await f.edit('cash'))).rejects.toMatchObject({code:'STALE_BASE'});
  const after=f.counts();for(const table of ['source_capture','report_input_snapshot','calculation_record','correction_preview'])expect(after[table]).toBe(counts[table]);
  expect(after.monthly_confirmation).toBe(before.monthly_confirmation+1);
});
it('correction manual parent/import는 다른 scope나 없는 검증 기록을 참조할 수 없다',async()=>{
  const r=open(),f=await fixture(r);
  await expect(r.putEvidence({...f.evidence,derivation:{kind:'manual-correction',parentId:f.captureId,importId:'nonexistent',patchHash:'patch',correctedAt:now}})).rejects.toThrow();
});

it.each([{noFetchedAt:true},{future:true}])('원래 clock trace/fallback과 미래 guard를 다음 달 수정 때 그대로 재생한다 %j',async options=>{
  const f=await correctionFixture(options),result=await f.validate!(f.deps,f.scopeId,await f.edit('cash')) as {previewId:string};
  const preview=await f.r.getCorrectionPreview(f.scopeId,result.previewId),candidate=await f.r.getCandidate(f.scopeId,preview!.candidateId);
  for(const indicator of ['construction','funding'] as const){const old=await f.r.getCalculation(f.scopeId,f.manifest.calculationIds[indicator]),next=await f.r.getCalculation(f.scopeId,candidate!.calculationIds[indicator]);expect(next?.evaluationClockTrace).toEqual(old?.evaluationClockTrace);expect(next?.resultJson).toEqual(old?.resultJson);expect(next?.origin).toBe(old?.origin);}
  expect(f.calls()).toBe(0);
});
it('평가 시간대가 달라지면 파생 쓰기 전에 명시적으로 중단한다',async()=>{
  const previous=process.env.TZ;
  try{process.env.TZ='Asia/Seoul';const f=await correctionFixture(),before=f.counts();process.env.TZ='UTC';await expect(f.validate!(f.deps,f.scopeId,await f.edit('cash'))).rejects.toMatchObject({code:'EVALUATION_ZONE_MISMATCH'});expect(f.counts()).toEqual(before);expect(f.calls()).toBe(0);process.env.TZ='Asia/Seoul';expect(await f.validate!(f.deps,f.scopeId,await f.edit('cash'))).toMatchObject({kind:'preview'});}
  finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
it('공표평균만 바꾸고 평가사별 값·원 수신일·원 문서와 기록은 보존한다',async()=>{
  const f=await correctionFixture(),result=await f.validate!(f.deps,f.scopeId,await f.edit('kofia')) as {previewId:string};
  const p=await f.r.getCorrectionPreview(f.scopeId,result.previewId),c=await f.r.getCandidate(f.scopeId,p!.candidateId),next=await f.r.getCalculation(f.scopeId,c!.calculationIds.funding),old=await f.r.getCalculation(f.scopeId,f.manifest.calculationIds.funding);
  const evidence=await f.r.getEvidence(f.scopeId,next!.captureIds[0]),original=await f.r.getEvidence(f.scopeId,old!.captureIds[0]);
  expect(evidence?.receivedAt).toBe(original?.receivedAt);expect(evidence?.derivation).toMatchObject({kind:'manual-correction',parentId:original?.captureId});
  const decoded=f.deps.decode!<{kind:string;value:{days:{publicAaa:{average:number;byAgency:unknown}}[];fetchedAt:Date}}>(evidence!.payloadJson);
  expect(decoded.value.days[0].publicAaa).toEqual({average:3.7,byAgency:{A:99}});expect(decoded.value.fetchedAt).toEqual(new Date(now));
  expect((await f.r.getConfirmation(f.scopeId,f.confirmed.confirmationId))?.document).toEqual(f.candidate.document);
  expect((await f.r.getCalculation(f.scopeId,old!.calculationId))?.resultJson).toEqual(old?.resultJson);
  const resultJson=f.deps.decode!<{value:{result:{spread:number}}}>(next!.resultJson);expect(resultJson.value.result.spread).toBe(1.2);
});
it('Unreadable 항목의 일부 복구는 원장 쓰기 0, 모든 기존 월 복구는 전체 입력 복원 성공이다',async()=>{
  const f=await correctionFixture({unreadable:true}),X=await import('xlsx'),before=f.counts();
  const patch=async(all:boolean)=>{const b=X.read(historyWorkbookCodec.encode(f.manifest),{type:'array'}),sheet=b.Sheets['자금자료_정정'];
    const rows=f.manifest.rows.filter(row=>row.sheet==='자금자료_정정');rows.forEach((row,index)=>{if(row.rowId.startsWith('statement:0:수입:')&&(all||row.rowId.endsWith(':0'))){const r=index+2;sheet[`G${r}`]={t:'s',v:'값수정'};sheet[`H${r}`]={t:'n',v:40};sheet[`I${r}`]={t:'s',v:'판독 복구'};}});return new Uint8Array(X.write(b,{type:'array',bookType:'xlsx'}));};
  expect(await f.validate!(f.deps,f.scopeId,await patch(false))).toMatchObject({kind:'invalid',errors:[{code:'INCOMPLETE_SERIES'}]});expect(f.counts()).toEqual(before);
  const result=await f.validate!(f.deps,f.scopeId,await patch(true)) as {previewId:string};const p=await f.r.getCorrectionPreview(f.scopeId,result.previewId);const input=await f.r.getInputSnapshot(f.scopeId,p!.inputSnapshotId);expect(input?.statements[0].amounts.수입).toEqual(Array(12).fill(40));
});
it('현재 의존 head 토큰은 문서 cutoff와 별개이며 기존 preview는 의존 head 변경 뒤 재기준화하지 않는다',async()=>{
  const f=await correctionFixture(),bytes=await f.edit('cash'),first=await f.validate!(f.deps,f.scopeId,bytes) as {previewId:string};
  const p=await f.r.getCorrectionPreview(f.scopeId,first.previewId);expect(p?.dependencyHeads).toContainEqual({reportCycle:basis.reportCycle,confirmationId:f.confirmed.confirmationId,revision:1});
  expect((await f.r.getHistorySelection(f.scopeId,f.manifest.historySelectionId))?.headRevisions).toEqual([]);
  const candidate=await f.r.getCandidate(f.scopeId,f.candidate.candidateId),newCandidate=await f.r.putCandidate({...candidate!,document:{...candidate!.document,contentHash:'later'}});
  await f.r.commitConfirmation(f.scopeId,{candidateId:newCandidate.candidateId,expectedRevision:1,idempotencyKey:'later',correctionReason:'합성 최신본'});
  const before=f.counts();await expect(f.validate!(f.deps,f.scopeId,bytes)).rejects.toMatchObject({code:'STALE_BASE'});expect(f.counts()).toEqual(before);expect(await f.r.getCorrectionPreview(f.scopeId,p!.previewId)).toEqual(p);
});

it('서식만 다른 재업로드는 동일 preview이고 산출값이 같아도 원자료 차이를 남긴다',async()=>{
  const f=await correctionFixture(),X=await import('xlsx'),bytes=await f.edit('kofia'),book=X.read(bytes,{type:'array'});book.Sheets['조달금리_정정'].H2.v=3.6741;
  const data=()=>new Uint8Array(X.write(book,{type:'array',bookType:'xlsx',compression:true}));
  const first=await f.validate!(f.deps,f.scopeId,data()) as {previewId:string};book.Sheets['조달금리_정정']['!cols']=[{wch:42}];
  expect(await f.validate!(f.deps,f.scopeId,data())).toEqual(first);
  const preview=await f.r.getCorrectionPreview(f.scopeId,first.previewId);expect(preview?.rawDiff).toEqual(expect.arrayContaining([expect.objectContaining({before:3.674,after:3.6741})]));
  expect(preview?.resultDiff).toEqual(expect.arrayContaining([expect.objectContaining({indicator:'funding',beforeDisplay:'1.174 · 위기',afterDisplay:'1.174 · 위기',changed:false})]));
});
it('다른 정정 branch가 부모 원천만 공유하면 가능 영향으로 표시하고 branch 값을 덮지 않는다',async()=>{
  const f=await correctionFixture();const initial=await f.validate!(f.deps,f.scopeId,await f.edit('kofia')) as {previewId:string};const preview=await f.r.getCorrectionPreview(f.scopeId,initial.previewId),candidate=await f.r.getCandidate(f.scopeId,preview!.candidateId),derived=await f.r.getCalculation(f.scopeId,candidate!.calculationIds.funding);
  const earlierBasis={reportCycle:yearMonth(2026,8),reportTitleMonth:yearMonth(2026,7),constructionBaseMonth:yearMonth(2026,6),fundingJudgedMonth:yearMonth(2026,8),fundingObservedMonth:yearMonth(2026,7),gapMonth:yearMonth(2026,8)};
  const other=await fixture(f.r,f.scopeId,'branch',earlierBasis);const linked=await f.r.putCalculation({...other.common,indicator:'funding',effectiveMonth:earlierBasis.fundingObservedMonth,inputHash:other.candidate.calculationInputHashes.funding,captureIds:derived!.captureIds});
  const c=await f.r.putCandidate({...other.candidate,calculationIds:{...other.candidate.calculationIds,funding:linked.calculationId}});const confirmed=await f.r.commitConfirmation(f.scopeId,{candidateId:c.candidateId,expectedRevision:0,idempotencyKey:'branch'});
  const before=await f.r.getCalculation(f.scopeId,linked.calculationId),count=f.counts().monthly_confirmation;
  const X=await import('xlsx'),book=X.read(await f.edit('kofia'),{type:'array'});book.Sheets['조달금리_정정'].H2.v=3.8;
  const result=await f.validate!(f.deps,f.scopeId,new Uint8Array(X.write(book,{type:'array',bookType:'xlsx'}))) as {previewId:string};const staged=await f.r.getCorrectionPreview(f.scopeId,result.previewId);
  expect(staged?.affectedReports).toEqual(expect.arrayContaining([expect.objectContaining({reportCycle:'2026/08',indicator:'funding',status:'possible',lineage:'shared-parent'})]));
  expect(await f.r.getCalculation(f.scopeId,linked.calculationId)).toEqual(before);expect(f.counts().monthly_confirmation).toBe(count);expect(confirmed.kind).toBe('confirmed');
});
it('참조한 과거 head가 바뀌면 동일 export/patch 재검증도 STALE_DEPENDENCY이며 preview를 갱신하지 않는다',async()=>{
  const f=await correctionFixture({history:true}),bytes=await f.edit('cash'),first=await f.validate!(f.deps,f.scopeId,bytes) as {previewId:string};
  const preview=await f.r.getCorrectionPreview(f.scopeId,first.previewId),prior=(await f.r.listConfirmations(f.scopeId)).find(c=>c.reportCycle==='2026/08')!;
  const candidate=await f.r.getCandidate(f.scopeId,prior.candidateId),next=await f.r.putCandidate({...candidate!,document:{...candidate!.document,contentHash:'dependency-change'}});
  const other=open(f.r.databasePath);await other.commitConfirmation(f.scopeId,{candidateId:next.candidateId,expectedRevision:1,idempotencyKey:'changed-dependency',correctionReason:'합성 수정'});
  const before=f.counts();await expect(f.validate!(f.deps,f.scopeId,bytes)).rejects.toMatchObject({code:'STALE_DEPENDENCY'});expect(f.counts()).toEqual(before);expect(await f.r.getCorrectionPreview(f.scopeId,preview!.previewId)).toEqual(preview);
});
it('자금 한 칸을 바꾼 전체 입력에서 기존 dashboard·건설·조달 함수의 결과와 정확히 같다',async()=>{
  const f=await correctionFixture(),X=await import('xlsx'),book=X.read(historyWorkbookCodec.encode(f.manifest),{type:'array'}),sheet=book.Sheets['자금자료_정정'];
  const rows=f.manifest.rows.filter(row=>row.sheet==='자금자료_정정'),r=rows.findIndex(row=>row.rowId==='statement:2:기초시재:8')+2;
  sheet[`G${r}`]={t:'s',v:'값수정'};sheet[`H${r}`]={t:'n',v:0};sheet[`I${r}`]={t:'s',v:'현재 기초시재 정정'};
  const result=await f.validate!(f.deps,f.scopeId,new Uint8Array(X.write(book,{type:'array',bookType:'xlsx'}))) as {previewId:string};
  const p=await f.r.getCorrectionPreview(f.scopeId,result.previewId),candidate=await f.r.getCandidate(f.scopeId,p!.candidateId);
  const expected=structuredClone(f.statements);expected[2].amounts.기초시재[8]=0;
  const {restoreStatement}=await import('../../application/report-history/report-candidate'),{assessDashboard}=await import('../../application/dashboard'),{ledgerOf}=await import('../../domain/cashflow/forecast-ledger'),{roundEntryOf}=await import('../../domain/cashflow/round-entry'),{assessPerception}=await import('../../application/construction-perception'),{assessFundingRiskReport}=await import('../../application/funding-risk');
  const restored=expected.map(restoreStatement),dashboard=assessDashboard(restored[1],restored[2],restored[2].months[8]);
  const document=f.deps.decode!<{dashboard:unknown;construction:unknown;funding:unknown}>(candidate!.document.json);
  expect(document.dashboard).toEqual(dashboard);expect(dashboard.liquidityGap).toMatchObject({ok:true,value:{gapRatio:0}});
  const ledger=ledgerOf(restored.map(roundEntryOf));
  for(const indicator of ['construction','funding'] as const){const parent=await f.r.getCalculation(f.scopeId,f.manifest.calculationIds[indicator]),evidence=await f.r.getEvidence(f.scopeId,parent!.captureIds[0]);let call=0;const clock=()=>new Date(parent!.evaluationClockTrace[call++]);
    const outcome=indicator==='construction'?await assessPerception(f.deps.replayIndicators!(f.deps.decode!(evidence!.payloadJson)),ledger,{reportMonth:basis.reportCycle},clock):await assessFundingRiskReport(f.deps.replayYields!(f.deps.decode!(evidence!.payloadJson)),{judgedMonth:basis.reportCycle},clock);
    expect(document[indicator]).toEqual(outcome);
  }
  expect((await f.r.getInputSnapshot(f.scopeId,candidate!.inputSnapshotId))?.statements).toEqual(expected);expect(candidate?.document.historyCalculationIds).toEqual(f.candidate.document.historyCalculationIds);expect(f.calls()).toBe(0);
});
it.each(['ecos:미분양주택현황:2026/06','ecos:총수주액:2025/07','statement:0:분양회수:6','statement:2:분양회수:6'])('전월·전년 비교와 회차 계획/실적 %s는 기존 건설 함수로 재현한다',async rowId=>{
  const f=await correctionFixture(),X=await import('xlsx'),book=X.read(historyWorkbookCodec.encode(f.manifest),{type:'array'}),row=f.manifest.rows.find(row=>row.rowId===rowId)!;
  const r=f.manifest.rows.filter(item=>item.sheet===row.sheet).findIndex(item=>item.rowId===rowId)+2,sheet=book.Sheets[row.sheet];sheet[`G${r}`]={t:'s',v:'값수정'};sheet[`H${r}`]={t:'n',v:65};sheet[`I${r}`]={t:'s',v:'비교 원자료 정정'};
  const result=await f.validate!(f.deps,f.scopeId,new Uint8Array(X.write(book,{type:'array',bookType:'xlsx'}))) as {previewId:string};
  const p=await f.r.getCorrectionPreview(f.scopeId,result.previewId),candidate=await f.r.getCandidate(f.scopeId,p!.candidateId),calculation=await f.r.getCalculation(f.scopeId,candidate!.calculationIds.construction),parent=await f.r.getCalculation(f.scopeId,f.manifest.calculationIds.construction),evidence=await f.r.getEvidence(f.scopeId,parent!.captureIds[0]);
  const observed=f.deps.decode!<import('../../application/report-history/ports').SourceObservation<import('../../application/ports').SourceResult>>(evidence!.payloadJson),expected=structuredClone(f.statements);
  if(row.sourceKind==='ecos'){if(observed.kind!=='returned')throw Error('fixture');const identity=row.identityJson as {indicator:keyof import('../../application/ports').SourceResult;month:import('../../domain/shared/year-month').YearMonth};const source=observed.value[identity.indicator];if(!('values'in source))throw Error('fixture');(source.values as Map<import('../../domain/shared/year-month').YearMonth,number>).set(identity.month,65);}
  else{const identity=row.identityJson as {statementIndex:number;monthIndex:number};expected[identity.statementIndex].amounts.분양회수[identity.monthIndex]=65;}
  const {restoreStatement}=await import('../../application/report-history/report-candidate'),{ledgerOf}=await import('../../domain/cashflow/forecast-ledger'),{roundEntryOf}=await import('../../domain/cashflow/round-entry'),{assessPerception}=await import('../../application/construction-perception');let calls=0;
  const outcome=await assessPerception(f.deps.replayIndicators!(observed),ledgerOf(expected.map(restoreStatement).map(roundEntryOf)),{reportMonth:basis.reportCycle},()=>new Date(parent!.evaluationClockTrace[calls++]));
  expect(f.deps.decode!(calculation!.resultJson)).toEqual(outcome);expect(calculation?.effectiveMonth).toBe(parent?.effectiveMonth);expect(f.calls()).toBe(0);expect((await f.r.getConfirmation(f.scopeId,f.confirmed.confirmationId))?.revision).toBe(1);
});

it('같은 원천 ID를 직접 참조한 다른 보고서는 기존 함수로 영향만 재계산하고 원본을 보존한다', async () => {
  const f = await correctionFixture();
  const { captureConstruction, captureFunding } = await import('../../application/report-history/report-history');
  const { prepareReportCandidate, restoreStatement } = await import('../../application/report-history/report-candidate');
  const { ledgerOf } = await import('../../domain/cashflow/forecast-ledger');
  const { roundEntryOf } = await import('../../domain/cashflow/round-entry');
  const { assessPerception } = await import('../../application/construction-perception');
  const construction = await f.r.getCalculation(f.scopeId, f.manifest.calculationIds.construction);
  const funding = await f.r.getCalculation(f.scopeId, f.manifest.calculationIds.funding);
  const economic = await f.r.getEvidence(f.scopeId, construction!.captureIds[0]);
  const bond = await f.r.getEvidence(f.scopeId, funding!.captureIds[0]);
  // Both report calculations explicitly reference these same immutable capture IDs.
  const repository = new Proxy(f.r, { get(target, key) {
    if (key === 'putEvidence') return async (input: { sourceKind: string }) => ({ captureId: input.sourceKind === 'ecos' ? economic!.captureId : bond!.captureId });
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const deps = { ...f.deps, repository, clock: () => new Date(now),
    indicators: f.deps.replayIndicators!(f.deps.decode!(economic!.payloadJson)),
    yields: f.deps.replayYields!(f.deps.decode!(bond!.payloadJson)),
  };
  const earlierBasis = { reportCycle: yearMonth(2026,8), reportTitleMonth: yearMonth(2026,7), constructionBaseMonth: yearMonth(2026,6), fundingJudgedMonth: yearMonth(2026,8), fundingObservedMonth: yearMonth(2026,7), gapMonth: yearMonth(2026,8) };
  const statements = f.statements.slice(0,2), ledger = ledgerOf(statements.map(restoreStatement).map(roundEntryOf));
  const c = await captureConstruction(deps, f.scopeId, { reportMonth: earlierBasis.reportCycle }, ledger);
  const y = await captureFunding(deps, f.scopeId, { judgedMonth: earlierBasis.fundingJudgedMonth });
  if (c.history.captureStatus !== 'saved' || y.history.captureStatus !== 'saved') throw Error('fixture failed');
  const selection = await f.r.createHistorySelection({ scopeId: f.scopeId, basis: earlierBasis, calculationVersion: version, asOf: now, selectedBackfillBatchId: null });
  const candidate = await prepareReportCandidate(deps, { scopeId: f.scopeId, basis: earlierBasis, statements, sourceMetadata: {}, constructionCalculationId: c.history.calculationId, fundingCalculationId: y.history.calculationId, historySelectionId: selection.historySelectionId, authoredAt: now, inputGeneration: 'shared-capture' }, f.deps.documentFactory);
  const confirmed = await f.r.commitConfirmation(f.scopeId, { candidateId: candidate.candidateId, expectedRevision: 0, idempotencyKey: 'shared-capture' });
  expect(confirmed.kind).toBe('confirmed');
  const beforeHeads = await f.r.currentHeads(f.scopeId, [basis.reportCycle, earlierBasis.reportCycle]);
  const X = await import('xlsx'), book = X.read(historyWorkbookCodec.encode(f.manifest), { type: 'array' });
  const rows = f.manifest.rows.filter(row => row.sheet === '경제지표_정정');
  const index = rows.findIndex(row => row.rowId.endsWith(':2026/06')), row = rows[index], n = index + 2;
  book.Sheets['경제지표_정정'][`G${n}`] = { t: 's', v: '값수정' };
  book.Sheets['경제지표_정정'][`H${n}`] = { t: 'n', v: 101 };
  book.Sheets['경제지표_정정'][`I${n}`] = { t: 's', v: '공유 원자료 검증' };
  const result = await f.validate!(f.deps, f.scopeId, new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' }))) as { previewId: string };
  const preview = await f.r.getCorrectionPreview(f.scopeId, result.previewId);
  const patched = f.deps.decode!<import('../../application/report-history/ports').SourceObservation<import('../../application/ports').SourceResult>>(economic!.payloadJson);
  if (patched.kind !== 'returned') throw Error('fixture source');
  const key = (row.identityJson as { indicator: keyof import('../../application/ports').SourceResult }).indicator;
  const series = patched.value[key];
  if (!('values' in series)) throw Error('fixture series');
  (series.values as Map<ReturnType<typeof yearMonth>,number>).set(yearMonth(2026,6), 101);
  const expected = await assessPerception(f.deps.replayIndicators!(patched), ledger, { reportMonth: earlierBasis.reportCycle }, () => new Date(now));
  const impact = (preview?.affectedReports as unknown as Record<string, unknown>[]).find(item => item.reportCycle === '2026/08' && item.indicator === 'construction');
  expect(impact?.status).toBe('recalculated');
  expect(impact?.before).toEqual(f.deps.encode(c.outcome));
  expect(impact?.after).toEqual(f.deps.encode(expected));
  expect(await f.r.currentHeads(f.scopeId, [basis.reportCycle, earlierBasis.reportCycle])).toEqual(beforeHeads);
  expect((await f.r.getCalculation(f.scopeId, c.history.calculationId))?.resultJson).toEqual(f.deps.encode(c.outcome));
  expect((await f.r.getCandidate(f.scopeId, candidate.candidateId))?.document).toEqual(candidate.document);
  expect(f.calls()).toBe(0);
});

it('마지막 평가일 공표평균 결측은 0이나 평가사 평균으로 대체하지 않고 기존 함수대로 산출불가다', async () => {
  const f = await correctionFixture(), X = await import('xlsx');
  const book = X.read(await f.edit('kofia'), { type: 'array' });
  book.Sheets['조달금리_정정'].G2 = { t: 's', v: '결측처리' };
  delete book.Sheets['조달금리_정정'].H2;
  const result = await f.validate!(f.deps, f.scopeId, new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' }))) as { previewId: string };
  const preview = await f.r.getCorrectionPreview(f.scopeId, result.previewId);
  expect(preview).not.toBeNull();
  const candidate = await f.r.getCandidate(f.scopeId, preview!.candidateId);
  const calculation = await f.r.getCalculation(f.scopeId, candidate!.calculationIds.funding);
  const evidence = await f.r.getEvidence(f.scopeId, calculation!.captureIds[0]);
  const observation = f.deps.decode!<import('../../application/report-history/ports').SourceObservation<import('../../application/ports').YieldFetch>>(evidence!.payloadJson);
  if (observation.kind !== 'returned' || !('days' in observation.value)) throw Error('fixture source');
  expect(observation.value.days[0].publicAaa).toEqual({ average: null, byAgency: { A: 99 } });
  const { assessFundingRiskReport } = await import('../../application/funding-risk');
  let calls = 0;
  const expected = await assessFundingRiskReport(f.deps.replayYields!(observation), { judgedMonth: basis.fundingJudgedMonth }, () => new Date(calculation!.evaluationClockTrace[calls++]));
  expect(calculation!.resultJson as unknown).toEqual(f.deps.encode(expected) as unknown);
  expect(expected).toMatchObject({ ok: true, value: { result: { kind: 'unavailable' } } });
  expect(f.calls()).toBe(0);
});

it.each((['input', 'evidence'] as const).flatMap(kind => ([128, 129, 'cycle', 'missing'] as const).map(shape => ({kind,shape}))))('부모 계보 $kind/$shape: 긴 정상 계보와 순환·없는 부모를 구분한다', async ({kind,shape}) => {
    const f = await correctionFixture();
    const calculation = await f.r.getCalculation(f.scopeId, f.manifest.calculationIds.funding);
    const rootId = kind === 'input' ? f.manifest.inputSnapshotId : calculation!.captureIds[0];
    const original = kind === 'input' ? await f.r.getInputSnapshot(f.scopeId, rootId) : await f.r.getEvidence(f.scopeId, rootId);
    const length = typeof shape === 'number' ? shape : 3;
    const ids = [rootId, ...Array.from({ length: length - 1 }, (_, index) => `synthetic-parent-${index}`)];
    const queried = new Set<string>();
    // Immutable repository-port graph: the service still restores/calculates/stages
    // through the real SQLite fixture; only historical ancestor reads are supplied.
    const repository = new Proxy(f.r, { get(target, key) {
      if (key === (kind === 'input' ? 'getInputSnapshot' : 'getEvidence')) return async (scope: string, id: string) => {
        const index = ids.indexOf(id);
        if (index >= 0 && scope === f.scopeId) {
          queried.add(id);
          const parentId = ids[index + 1] ?? (shape === 'cycle' ? ids[0] : shape === 'missing' ? 'missing-parent' : null);
          return { ...original, [kind === 'input' ? 'inputSnapshotId' : 'captureId']: id, derivation: parentId ? { kind: 'manual-correction', parentId, importId: 'synthetic-import', patchHash: 'synthetic-patch', correctedAt: now } : { kind: 'captured' } };
        }
        return kind === 'input' ? target.getInputSnapshot(scope,id) : target.getEvidence(scope,id);
      };
      const value = Reflect.get(target,key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const before = f.counts();
    const validate = () => f.validate!({ ...f.deps, repository }, f.scopeId, bytes);
    const bytes = await f.edit(kind === 'input' ? 'cash' : 'kofia');
    if (typeof shape === 'number') {
      expect(await validate()).toMatchObject({kind:'preview'});
      expect(queried.size).toBe(shape);
      expect(f.counts().correction_preview).toBe(before.correction_preview + 1);
      expect(f.counts().monthly_head).toBe(before.monthly_head);
    } else {
      await expect(validate()).rejects.toThrow('INVALID_LINEAGE');
      expect(f.counts()).toEqual(before);
    }
});

async function webFixture() {
  const r = open(), f = await fixture(r);
  const confirmed = await r.commitConfirmation('scope-A', { candidateId: f.candidateId, expectedRevision: 0, idempotencyKey: 'web-base' });
  if (confirmed.kind !== 'confirmed') throw Error('fixture');
  const neutral: import('../../application/report-history/ports').CorrectionBasis = {
    recordKind: 'correction-basis', payloadVersion: 2, basisId: 'web-basis', scopeId: 'scope-A', baseConfirmationId: confirmed.confirmationId,
    baseRevision: 1, baseDocumentHash: f.candidate.document.contentHash, basis, inputSnapshotId: f.inputSnapshotId, inputHash: f.candidate.inputHash,
    calculationIds: f.candidate.calculationIds, historySelectionId: f.candidate.historySelectionId, calculationVersion: version, templateVersion: 'report@e3a8f9e', createdAt: now,
    rows: [{ rowId: 'economic', category: 'economic', label: '합성 지수', sourceRound: month, period: basis.constructionBaseMonth, unit: '지수', originalText: '0', originalState: 'available', allowedActions: ['set','set-missing'], sourceRecordId: f.captureId, fieldPath: 'value', originalValue: 0, sourceIdentity: { kind:'ecos', indicator:'synthetic', statistic:'synthetic', items:[] } }],
  };
  await r.putCorrectionBasis(neutral);
  return { r, f, neutral, confirmed };
}
const rawContent = { edits: [{ rowId:'economic', action:'set' as const, rawValue:'-' }], reason:'', evidenceNote:'' };
describe('schema4 correction work persistence', () => {
  it('schema4 adds exactly three tables', () => {
    const r = open(), db = new DatabaseSync(r.databasePath, {readOnly:true});
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(4);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toHaveLength(21); db.close();
  });
  it('invalid_draft_autosaves_without_derivation_or_head_change', async () => {
    const { r, neutral } = await webFixture();
    const draft = await r.createCorrectionDraft('scope-A', { basisId:neutral.basisId, idempotencyKey:'create', content:rawContent });
    expect(draft).toMatchObject({ draftRevision:1, content:rawContent, currentPreviewId:null });
    expect(await r.currentHeads('scope-A',[month])).toMatchObject([{revision:1}]);
    expect(await r.getCorrectionDraft('other',draft!.draftId)).toBeNull();
    const db = new DatabaseSync(r.databasePath); expect(db.prepare('SELECT count(*) AS n FROM correction_preview').get()?.n).toBe(0); db.close();
  });
  it('draft_revision_cas_rejects_out_of_order_and_two_tab_writes and original ACK never reverts draft', async () => {
    const {r,neutral}=await webFixture(), other=open(r.databasePath);
    const d=(await r.createCorrectionDraft('scope-A',{basisId:neutral.basisId,idempotencyKey:'create',content:rawContent}))!;
    const cmd={draftId:d.draftId,expectedDraftRevision:1,idempotencyKey:'save',content:{...rawContent,reason:'first'}};
    const ack=await r.saveCorrectionDraft('scope-A',cmd);
    await expect(other.saveCorrectionDraft('scope-A',{...cmd,idempotencyKey:'tab'})).rejects.toMatchObject({code:'STALE_DRAFT'});
    await r.saveCorrectionDraft('scope-A',{...cmd,expectedDraftRevision:2,idempotencyKey:'new',content:{...rawContent,reason:'latest'}});
    expect(await other.saveCorrectionDraft('scope-A',cmd)).toEqual(ack);
    expect((await r.getCorrectionDraft('scope-A',d.draftId))?.content.reason).toBe('latest');
    await expect(r.saveCorrectionDraft('scope-A',{...cmd,content:rawContent})).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_REUSED'});
  });
  it('closed_legacy_preview_cannot_be_newly_confirmed and completed_detail_read_is_write_free',async()=>{
    const f=await correctionFixture(), p=await f.validate!(f.deps,f.scopeId,await f.edit('cash')) as {previewId:string;previewHash:string};
    const ref={kind:'legacy-preview' as const,id:p.previewId};
    const cmd={ref,expectedDraftRevision:null,idempotencyKey:'close'};
    const closed=await f.r.closeCorrectionWork(f.scopeId,cmd);
    expect(closed.state).toBe('closed'); expect(await f.r.closeCorrectionWork(f.scopeId,cmd)).toEqual(closed);
    expect(await f.r.commitCorrection(f.scopeId,{...p,expectedBaseRevision:1,idempotencyKey:'confirm-closed',reason:'합성 정정'})).toMatchObject({kind:'conflict',reason:'WORK_CLOSED'});
    const ro=open(f.r.databasePath,{readOnly:true});
    expect((await ro.getCorrectionReviewDetail(f.scopeId,ref))?.summary.state).toBe('closed');
  });
});

const validContent = { edits:[{rowId:'economic',action:'set' as const,rawValue:'7'}],reason:'합성 정정',evidenceNote:'합성 근거' };
async function createWebDraft(f:Awaited<ReturnType<typeof webFixture>>,key=crypto.randomUUID()) { return (await f.r.createCorrectionDraft('scope-A',{basisId:f.neutral.basisId,idempotencyKey:key,content:validContent}))!; }
async function webStage(f:Awaited<ReturnType<typeof webFixture>>,d:import('../../application/report-history/ports').StoredCorrectionDraft) {
  const {normalizeCorrectionEdits}=await import('../../domain/report-history/correction');
  const v=normalizeCorrectionEdits(f.neutral,{basisId:f.neutral.basisId,reason:d.content.reason,edits:d.content.edits.map(e=>({...e,evidenceNote:d.content.evidenceNote}))});if(v.kind!=='valid') throw Error('fixture');
  const id=crypto.randomUUID(),heads=await f.r.currentHeads(f.neutral.scopeId,[month]);
  const submission={recordKind:'correction-submission' as const,payloadVersion:2 as const,scopeId:f.neutral.scopeId,submissionId:'submission-'+id,basisId:f.neutral.basisId,draftId:d.draftId,draftRevision:d.draftRevision,submissionHash:hashHistoryValue({d,patch:v.patch}),patchHash:hashHistoryValue(v.patch),patch:v.patch,reason:v.reason,evidenceNote:d.content.evidenceNote.trim(),baseConfirmationId:f.confirmed.confirmationId,baseRevision:1,dependencyHeads:heads,createdAt:now};
  const preview={recordKind:'correction-preview' as const,payloadVersion:2 as const,scopeId:f.neutral.scopeId,previewId:'preview-'+id,previewHash:hashHistoryValue({submission,candidateId:id}),submissionId:submission.submissionId,basisId:f.neutral.basisId,draftId:d.draftId,draftRevision:d.draftRevision,baseConfirmationId:f.confirmed.confirmationId,baseRevision:1,inputSnapshotId:f.f.inputSnapshotId,candidateId:id,dependencyHeads:heads,rawDiff:[],resultDiff:[],affectedReports:[],createdAt:now};
  submission.submissionHash=hashHistoryValue({basisId:submission.basisId,draftId:d.draftId,draftRevision:d.draftRevision,patch:submission.patch,reason:submission.reason,evidenceNote:submission.evidenceNote,baseConfirmationId:submission.baseConfirmationId,baseRevision:submission.baseRevision,dependencyHeads:heads,inputSnapshotId:f.f.inputSnapshotId,calculationIds:f.f.candidate.calculationIds,historySelectionId:f.f.candidate.historySelectionId,documentHash:f.f.candidate.document.contentHash});
  const {previewHash:ignored,...previewBody}=preview;void ignored;preview.previewHash=hashHistoryValue({...previewBody,submissionHash:submission.submissionHash});
  const stage={scopeId:f.neutral.scopeId,expectedBase:heads[0],dependencyHeads:heads,draft:{draftId:d.draftId,draftRevision:d.draftRevision},evidence:[],inputs:[],calculations:[],submission,preview,candidate:{...f.f.candidate,candidateId:id,correctionPreviewId:preview.previewId}};
  return {stage,preview:await f.r.stageCorrection(stage)};
}
function confirmWeb(p:import('../../application/report-history/ports').StoredCorrectionPreview,key=crypto.randomUUID()) {return {previewId:p.previewId,previewHash:p.previewHash,expectedBaseRevision:p.baseRevision,idempotencyKey:key,reason:validContent.reason};}
describe('schema4 complete lifecycle contracts',()=>{
  it('editing_invalidates_current_preview_without_mutating_old_preview; confirm_rejects_outdated_draft_revision; same_patch_after_edit_requires_current_draft_preview',async()=>{
    const f=await webFixture(),d=await createWebDraft(f),{stage,preview}=await webStage(f,d);
    const edited=await f.r.saveCorrectionDraft('scope-A',{draftId:d.draftId,expectedDraftRevision:1,idempotencyKey:'edit',content:{...validContent,edits:[{...validContent.edits[0],rawValue:'8'}]}});
    expect(edited.currentPreviewId).toBeNull();expect(await f.r.getCorrectionPreview('scope-A',preview.previewId)).toEqual(preview);
    expect(await f.r.commitCorrection('scope-A',confirmWeb(preview))).toMatchObject({kind:'conflict',reason:'STALE_DRAFT'});
    await expect(f.r.stageCorrection(stage)).rejects.toMatchObject({code:'STALE_DRAFT'});
    const back=await f.r.saveCorrectionDraft('scope-A',{draftId:d.draftId,expectedDraftRevision:2,idempotencyKey:'back',content:validContent});
    const next=await webStage(f,back);expect(next.preview.previewId).not.toBe(preview.previewId);expect(await f.r.stageCorrection(next.stage)).toEqual(next.preview);
    expect(await f.r.commitCorrection('scope-A',confirmWeb(next.preview))).toMatchObject({kind:'confirmed',revision:2});
    const db=new DatabaseSync(f.r.databasePath,{readOnly:true});const bodies=db.prepare('SELECT body FROM workbook_import').all().map(row=>decodeEvidence<Record<string,unknown>>(String(row.body)));
    expect(bodies).toHaveLength(2);expect(bodies.every(b=>b.recordKind==='correction-submission'&&!('fileHash' in b))).toBe(true);db.close();
  });
  it('close_and_confirm_are_atomic_and_idempotent; successful_confirmation_retry_precedes_later_resolution_checks',async()=>{
    const f=await webFixture(),d=await createWebDraft(f),{preview}=await webStage(f,d),other=open(f.r.databasePath);
    const close={ref:{kind:'draft' as const,id:d.draftId},expectedDraftRevision:1,idempotencyKey:'close'};
    const closed=await other.closeCorrectionWork('scope-A',close);expect(await f.r.closeCorrectionWork('scope-A',close)).toEqual(closed);
    expect(await f.r.commitCorrection('scope-A',confirmWeb(preview))).toMatchObject({kind:'conflict',reason:'WORK_CLOSED'});
    const d2=await createWebDraft(f),p2=(await webStage(f,d2)).preview,cmd=confirmWeb(p2,'success');const success=await f.r.commitCorrection('scope-A',cmd);expect(success.kind).toBe('confirmed');
    await expect(other.closeCorrectionWork('scope-A',{...close,ref:{kind:'draft',id:d2.draftId},idempotencyKey:'close-done'})).rejects.toMatchObject({code:'WORK_CLOSED'});
    const fresh=await fixture(f.r,'scope-A','later');await f.r.commitConfirmation('scope-A',{candidateId:fresh.candidateId,expectedRevision:2,idempotencyKey:'later',correctionReason:'후속'});
    expect(await other.commitCorrection('scope-A',cmd)).toMatchObject({...success,kind:'already-confirmed'});expect(await f.r.currentHeads('scope-A',[month])).toMatchObject([{revision:3}]);
  });
  it('old_preview_reflection_cannot_close_edited_draft; already_applied_resolution_is_stable_after_later_head_changes',async()=>{
    const f=await webFixture(),a=await createWebDraft(f),b=await createWebDraft(f),c=await createWebDraft(f);const pa=(await webStage(f,a)).preview;await webStage(f,b);await webStage(f,c);
    await f.r.saveCorrectionDraft('scope-A',{draftId:c.draftId,expectedDraftRevision:1,idempotencyKey:'edited',content:{...validContent,edits:[{...validContent.edits[0],rawValue:'9'}]}});
    expect((await f.r.commitCorrection('scope-A',confirmWeb(pa))).kind).toBe('confirmed');
    expect((await f.r.getCorrectionReviewDetail('scope-A',{kind:'draft',id:b.draftId}))?.summary.state).toBe('reflected');expect(await f.r.getCorrectionResolution('scope-A',{kind:'draft',id:c.draftId})).toBeNull();
    const fresh=await fixture(f.r,'scope-A','after');await f.r.commitConfirmation('scope-A',{candidateId:fresh.candidateId,expectedRevision:2,idempotencyKey:'after',correctionReason:'후속'});
    expect((await f.r.getCorrectionReviewDetail('scope-A',{kind:'draft',id:b.draftId}))?.summary.state).toBe('reflected');expect((await f.r.getCorrectionReviewDetail('scope-A',{kind:'draft',id:a.draftId}))?.summary.state).toBe('confirmed');
  });
  it('work_list_spans_all_revisions_and_paginates_without_loss; month_counts_include_every_page_and_missing_months_are_not_filled',async()=>{
    const f=await webFixture();for(let i=0;i<27;i++)await createWebDraft(f,'draft-'+i);
    let page=await f.r.listCorrectionWork('scope-A',{pendingOnly:true,limit:20});const items=[...page.items];expect(items).toHaveLength(20);const late=await createWebDraft(f,'late');
    while(page.nextCursor){page=await f.r.listCorrectionWork('scope-A',{pendingOnly:true,limit:20,cursor:page.nextCursor});items.push(...page.items);}
    expect(new Set(items.map(i=>i.ref.id)).size).toBe(27);expect(items.some(i=>i.ref.id===late.draftId)).toBe(false);
    const months=await f.r.listCorrectionMonths('scope-A',{pendingOnly:false,limit:12});expect(months.items).toMatchObject([{reportCycle:month,reportTitleMonth:basis.reportTitleMonth,pendingCount:28,draftCount:28}]);expect(months.items).toHaveLength(1);
  });
  it('unknown_payload_is_rejected',async()=>{
    const f=await webFixture(),db=new DatabaseSync(f.r.databasePath);db.exec('DROP TRIGGER immutable_workbook_export_update');db.prepare('UPDATE workbook_export SET body=? WHERE id=?').run(encodeEvidence({...f.neutral,recordKind:'future-basis',payloadVersion:3}),f.neutral.basisId);db.close();
    await expect(f.r.getCorrectionBasis('scope-A',f.neutral.basisId)).rejects.toMatchObject({code:'UNSUPPORTED_VERSION'});
  });
});

function ledgerSnapshot(path:string) {
  const db=new DatabaseSync(path,{readOnly:true}),tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('correction_draft','correction_work_command','correction_resolution') ORDER BY name").all().map(r=>String(r.name));
  const rows=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM ${t}${t==='schema_migration'?' WHERE version<=3':''} ORDER BY rowid`).all()]));
  const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name NOT IN ('correction_draft','correction_work_command','correction_resolution') ORDER BY name").all();db.close();return {rows,triggers};
}
function schema3Only(path:string) {
  const db=new DatabaseSync(path);db.exec('DROP TABLE correction_resolution; DROP TABLE correction_work_command; DROP TABLE correction_draft; DELETE FROM schema_migration WHERE version=4; PRAGMA user_version=3');db.close();
}
describe('schema4 migration and adversarial storage',()=>{
  it('schema3_upgrade_preserves_every_existing_body_hash_and_head; legacy_preview_retry_survives_upgrade',async()=>{
    const f=await correctionFixture(),p=await f.validate!(f.deps,f.scopeId,await f.edit('cash')) as {previewId:string;previewHash:string},cmd={...p,expectedBaseRevision:1,idempotencyKey:'before-upgrade',reason:'합성 정정'};
    const confirmed=await f.r.commitCorrection(f.scopeId,cmd);f.r.close();schema3Only(f.r.databasePath);
    const before=ledgerSnapshot(f.r.databasePath);const legacyRo=open(f.r.databasePath,{readOnly:true});expect((await legacyRo.getCorrectionReviewDetail(f.scopeId,{kind:'legacy-preview',id:p.previewId}))?.summary.state).toBe('confirmed');legacyRo.close();expect(ledgerSnapshot(f.r.databasePath)).toEqual(before);expect(Object.keys(before.rows)).toHaveLength(18);expect(before.triggers).toHaveLength(26);
    const r=open(f.r.databasePath);expect(ledgerSnapshot(r.databasePath)).toEqual(before);expect(await r.commitCorrection(f.scopeId,cmd)).toEqual({...confirmed,kind:'already-confirmed'});
    const db=new DatabaseSync(r.databasePath,{readOnly:true});expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);expect(db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');db.close();
    const backup=await r.backup(),restored=open(backup,{readOnly:true});expect(await restored.getCorrectionPreview(f.scopeId,p.previewId)).toEqual(await r.getCorrectionPreview(f.scopeId,p.previewId));
  });
  it('migration failure rolls DDL/version back and retry succeeds; old executable rejects schema4',async()=>{
    const r=open();r.close();schema3Only(r.databasePath);const db=new DatabaseSync(r.databasePath);
    db.exec("CREATE TRIGGER stop_v4 BEFORE INSERT ON schema_migration WHEN NEW.version=4 BEGIN SELECT RAISE(ABORT,'SYNTHETIC_MIGRATION_FAIL');END;");
    expect(()=>open(r.databasePath)).toThrow('SYNTHETIC_MIGRATION_FAIL');expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(3);expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'correction_draft%'").all()).toEqual([]);
    db.exec('DROP TRIGGER stop_v4');db.close();open(r.databasePath);
    const old=spawnSync(process.execPath,['--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1],{readOnly:true});if(db.prepare('PRAGMA user_version').get().user_version>3){console.error('UNSUPPORTED_SCHEMA_VERSION');process.exitCode=1;}db.close();",r.databasePath],{encoding:'utf8'});expect(old.status).toBe(1);expect(old.stderr).toContain('UNSUPPORTED_SCHEMA_VERSION');
  });
  it('completed_detail_read_is_write_free and legacy statement sourceRound is canonical YYYY/MM',async()=>{
    const f=await correctionFixture(),p=await f.validate!(f.deps,f.scopeId,await f.edit('cash')) as {previewId:string},ref={kind:'legacy-preview' as const,id:p.previewId};await f.r.closeCorrectionWork(f.scopeId,{ref,expectedDraftRevision:null,idempotencyKey:'close-ro'});
    const before=ledgerSnapshot(f.r.databasePath),raw=new DatabaseSync(f.r.databasePath),change=raw.prepare('PRAGMA data_version').get();const ro=open(f.r.databasePath,{readOnly:true});
    const detail=await ro.getCorrectionReviewDetail(f.scopeId,ref);expect(detail?.rows[0].sourceRound).toBe('2026/06');expect(detail?.summary.state).toBe('closed');await ro.listCorrectionWork(f.scopeId,{pendingOnly:false,limit:20});await ro.listCorrectionMonths(f.scopeId,{pendingOnly:false,limit:12});
    expect(raw.prepare('PRAGMA data_version').get()).toEqual(change);expect(ledgerSnapshot(f.r.databasePath)).toEqual(before);raw.close();
  });
  it('ignored draft UPDATE cannot acknowledge a save or leave a staged preview behind',async()=>{
    const f=await webFixture(),d=await createWebDraft(f),db=new DatabaseSync(f.r.databasePath);db.exec('CREATE TRIGGER ignore_draft BEFORE UPDATE ON correction_draft BEGIN SELECT RAISE(IGNORE);END;');
    await expect(f.r.saveCorrectionDraft('scope-A',{draftId:d.draftId,expectedDraftRevision:1,idempotencyKey:'ignored',content:rawContent})).rejects.toMatchObject({code:'STALE_DRAFT'});
    await expect(webStage(f,d)).rejects.toMatchObject({code:'STALE_DRAFT'});expect(await f.r.getCorrectionWorkCommand('scope-A','ignored')).toBeNull();expect(db.prepare('SELECT count(*) AS n FROM correction_preview').get()?.n).toBe(0);db.exec('DROP TRIGGER ignore_draft');db.close();
  });
  it('copy and reapply use independent commands with head CAS and preserve original closed work',async()=>{
    const f=await webFixture(),d=await createWebDraft(f),ref={kind:'draft' as const,id:d.draftId};await f.r.closeCorrectionWork('scope-A',{ref,expectedDraftRevision:1,idempotencyKey:'closed'});
    const head=(await f.r.currentHeads('scope-A',[month]))[0],copy={...d,draftId:'copy',requiresReapply:true,copiedFrom:ref,originalBasisId:d.basisId,proposedContent:d.content,content:{edits:[],reason:'',evidenceNote:''}};
    const mutation={draft:copy,expectedDraftRevision:null,expectedHead:head,command:{action:'copy' as const,idempotencyKey:'copy',requestHash:'copy-hash'}};
    expect(await f.r.writeCorrectionDraft(mutation)).toEqual(copy);expect(await f.r.writeCorrectionDraft(mutation)).toEqual(copy);await expect(webStage(f,{...copy,content:d.content})).rejects.toMatchObject({code:'INVALID_DRAFT'});
    const noChange={scopeId:'scope-A',action:'reapply' as const,idempotencyKey:'nochange-reapply',requestHash:'nochange-reapply',expectedHead:head,ref:{kind:'draft' as const,id:copy.draftId},expectedDraftRevision:1};
    expect(await f.r.completeCorrectionWorkCommand(noChange)).toEqual({kind:'no-change'});
    const reapply={...copy,draftRevision:2,requiresReapply:false,content:d.content};await expect(f.r.writeCorrectionDraft({draft:reapply,expectedDraftRevision:1,expectedHead:{...head,revision:0},command:{action:'reapply',idempotencyKey:'reapply',requestHash:'reapply-hash'}})).rejects.toMatchObject({code:'STALE_BASE'});
    const applied=await f.r.writeCorrectionDraft({draft:reapply,expectedDraftRevision:1,expectedHead:head,command:{action:'reapply',idempotencyKey:'reapply',requestHash:'reapply-hash'}});expect(applied).toMatchObject({requiresReapply:false});expect(await f.r.completeCorrectionWorkCommand(noChange)).toEqual({kind:'no-change'});expect((await f.r.getCorrectionReviewDetail('scope-A',ref))?.summary.state).toBe('closed');
  });
});

it('neutral payload identifiers cover draft version patch reason heads calculation and document refs',async()=>{
  const f=await webFixture(),d=await createWebDraft(f),first=await webStage(f,d);
  const updated=await f.r.saveCorrectionDraft('scope-A',{draftId:d.draftId,expectedDraftRevision:1,idempotencyKey:'hash-edit',content:validContent});
  const stage={...first.stage,draft:{draftId:d.draftId,draftRevision:updated.draftRevision},submission:{...first.stage.submission,draftRevision:updated.draftRevision},preview:{...first.stage.preview,draftRevision:updated.draftRevision}};
  await expect(f.r.stageCorrection(stage)).rejects.toMatchObject({code:'INVALID_DRAFT'});
});
it('month cursor traverses sparse report title months with complete counts and every confirmation revision',async()=>{
  const r=open();
  for(let i=0;i<24;i++){
    const cycle=yearMonth(2025+Math.floor(i/6),(i%6)*2+1),b={reportCycle:cycle,reportTitleMonth:(await import('../../domain/shared/year-month')).addMonths(cycle,-1),constructionBaseMonth:(await import('../../domain/shared/year-month')).addMonths(cycle,-2),fundingJudgedMonth:cycle,fundingObservedMonth:(await import('../../domain/shared/year-month')).addMonths(cycle,-1),gapMonth:cycle};
    const f=await fixture(r,'scope-A','sparse-'+i,b);await r.commitConfirmation('scope-A',{candidateId:f.candidateId,expectedRevision:0,idempotencyKey:'sparse-'+i});
  }
  const page=await r.listCorrectionMonths('scope-A',{pendingOnly:false,limit:12});expect(page.items).toHaveLength(12);expect(page.nextCursor).not.toBeNull();
  const next=await r.listCorrectionMonths('scope-A',{pendingOnly:false,limit:12,cursor:page.nextCursor!});expect(next.items).toHaveLength(12);expect(new Set([...page.items,...next.items].map(m=>m.reportTitleMonth)).size).toBe(24);
  const ranged=await r.listCorrectionMonths('scope-A',{pendingOnly:false,limit:12,fromCycle:'2027/01',toCycle:'2027/12'});expect(ranged.items).toHaveLength(6);expect(ranged.items.every(m=>m.reportTitleMonth<m.reportCycle)).toBe(true);
});

it('no-change copy receipt precedes later heads and cannot be reused for a different request',async()=>{
  const f=await webFixture(),d=await createWebDraft(f),ref={kind:'draft' as const,id:d.draftId};await f.r.closeCorrectionWork('scope-A',{ref,expectedDraftRevision:1,idempotencyKey:'close-nochange'});
  const expectedHead=(await f.r.currentHeads('scope-A',[month]))[0],cmd={scopeId:'scope-A',action:'copy' as const,idempotencyKey:'nochange',requestHash:'request-a',expectedHead,ref,expectedDraftRevision:null};
  const before=ledgerSnapshot(f.r.databasePath);expect(await f.r.completeCorrectionWorkCommand(cmd)).toEqual({kind:'no-change'});expect(ledgerSnapshot(f.r.databasePath)).toEqual(before);
  const later=await fixture(f.r,'scope-A','new-head');await f.r.commitConfirmation('scope-A',{candidateId:later.candidateId,expectedRevision:1,idempotencyKey:'new-head',correctionReason:'합성'});
  expect(await f.r.completeCorrectionWorkCommand(cmd)).toEqual({kind:'no-change'});await expect(f.r.completeCorrectionWorkCommand({...cmd,requestHash:'request-b'})).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_REUSED'});
  await expect(f.r.completeCorrectionWorkCommand({...cmd,idempotencyKey:'fresh-request'})).rejects.toMatchObject({code:'STALE_BASE'});expect((await f.r.getCorrectionDraft('scope-A',d.draftId))?.draftRevision).toBe(1);
});
it('reflection requires every semantic row and keeps partial/mismatched/unit/ambiguous proposals open',async()=>{
  const f=await webFixture();
  const row2={...f.neutral.rows[0],rowId:'second',label:'두번째',period:yearMonth(2026,6)};
  const multi={...f.neutral,basisId:'multi',rows:[...f.neutral.rows,row2]};await f.r.putCorrectionBasis(multi);
  const multiDraft=(await f.r.createCorrectionDraft('scope-A',{basisId:'multi',idempotencyKey:'multi',content:{...validContent,edits:[...validContent.edits,{rowId:'second',action:'set',rawValue:'2'}]}}))!;
  await webStage({...f,neutral:multi},multiDraft);
  const unitBasis={...f.neutral,basisId:'unit',rows:f.neutral.rows.map(r=>({...r,unit:'원'}))};await f.r.putCorrectionBasis(unitBasis);const unitDraft=await createWebDraft({...f,neutral:unitBasis},'unit');await webStage({...f,neutral:unitBasis},unitDraft);
  const ambiguous={...f.neutral,basisId:'ambiguous',rows:[...f.neutral.rows,{...f.neutral.rows[0],rowId:'alias'}]};await f.r.putCorrectionBasis(ambiguous);const ambiguousDraft=await createWebDraft({...f,neutral:ambiguous},'ambiguous');await webStage({...f,neutral:ambiguous},ambiguousDraft);
  const winner=await createWebDraft(f,'winner'),p=(await webStage(f,winner)).preview;await f.r.commitCorrection('scope-A',confirmWeb(p));
  for(const d of [multiDraft,unitDraft,ambiguousDraft]) expect(await f.r.getCorrectionResolution('scope-A',{kind:'draft',id:d.draftId})).toBeNull();
});
it('legacy and neutral web basis share canonical meaning; both resolve only complete matching proposals',async()=>{
  const f=await correctionFixture(),legacy=await f.validate!(f.deps,f.scopeId,await f.edit('cash')) as {previewId:string},p=await f.r.getCorrectionPreview(f.scopeId,legacy.previewId);
  const original=(await f.r.getCorrectionBasis(f.scopeId,f.manifest.exportId))!;
  expect(original.rows.find(r=>r.category==='cashflow')?.sourceRound).toBe('2026/06');
  const neutral={...original,basisId:'web-again'};await f.r.putCorrectionBasis(neutral);
  const patch=(await f.r.getCorrectionSubmission(f.scopeId,'importId' in p! ? p.importId : p!.submissionId))!.patch;
  const content={edits:patch.map(e=>({rowId:e.rowId,action:e.action,rawValue:e.value===null?null:String(e.value)})),reason:'합성 정정',evidenceNote:''};
  const d=(await f.r.createCorrectionDraft(f.scopeId,{basisId:neutral.basisId,idempotencyKey:'neutral-draft',content}))!;
  const baseCandidate=(await f.r.getCandidate(f.scopeId,f.candidate.candidateId))!;
  const wf={r:f.r,neutral,confirmed:f.confirmed,f:{candidate:baseCandidate,inputSnapshotId:baseCandidate.inputSnapshotId}} as unknown as Awaited<ReturnType<typeof webFixture>>;
  await webStage(wf,d);
  await f.r.commitCorrection(f.scopeId,{previewId:p!.previewId,previewHash:p!.previewHash,expectedBaseRevision:1,idempotencyKey:'legacy-winner',reason:'합성 정정'});
  expect(await f.r.getCorrectionResolution(f.scopeId,{kind:'draft',id:d.draftId})).toMatchObject({kind:'reflected'});expect((await f.r.getCorrectionDraft(f.scopeId,d.draftId))?.content).toEqual(content);
});
it('draft save and close receipt failures rollback body and resolution; raw boundaries are enforced',async()=>{
  const f=await webFixture(),d=await createWebDraft(f),db=new DatabaseSync(f.r.databasePath);
  await expect(f.r.saveCorrectionDraft('scope-A',{draftId:d.draftId,expectedDraftRevision:1,idempotencyKey:'bad-row',content:{...rawContent,edits:[{rowId:'other-scope-row',action:'set',rawValue:'-'}]}})).rejects.toMatchObject({code:'INVALID_DRAFT'});
  db.exec("CREATE TRIGGER fail_work_command BEFORE INSERT ON correction_work_command BEGIN SELECT RAISE(ABORT,'SYNTHETIC_DISK_FAILURE');END;");
  await expect(f.r.saveCorrectionDraft('scope-A',{draftId:d.draftId,expectedDraftRevision:1,idempotencyKey:'fail-save',content:rawContent})).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'});
  await expect(f.r.closeCorrectionWork('scope-A',{ref:{kind:'draft',id:d.draftId},expectedDraftRevision:1,idempotencyKey:'fail-close'})).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE'});
  expect(await f.r.getCorrectionDraft('scope-A',d.draftId)).toEqual(d);expect(await f.r.getCorrectionResolution('scope-A',{kind:'draft',id:d.draftId})).toBeNull();db.exec('DROP TRIGGER fail_work_command');db.close();
});

it('work list retains drafts from every revision and month head counts all of them',async()=>{
  const f=await webFixture(),old=await createWebDraft(f,'old-revision'),fresh=await fixture(f.r,'scope-A','revision-two');
  const confirmed=await f.r.commitConfirmation('scope-A',{candidateId:fresh.candidateId,expectedRevision:1,idempotencyKey:'revision-two',correctionReason:'합성'});if(confirmed.kind!=='confirmed')throw Error('fixture');
  const nextBasis={...f.neutral,basisId:'basis-revision-two',baseConfirmationId:confirmed.confirmationId,baseRevision:2,baseDocumentHash:fresh.candidate.document.contentHash,inputSnapshotId:fresh.inputSnapshotId,inputHash:fresh.candidate.inputHash,calculationIds:fresh.candidate.calculationIds,historySelectionId:fresh.candidate.historySelectionId};await f.r.putCorrectionBasis(nextBasis);
  const current=(await f.r.createCorrectionDraft('scope-A',{basisId:nextBasis.basisId,idempotencyKey:'current-revision',content:validContent}))!;
  const list=await f.r.listCorrectionWork('scope-A',{pendingOnly:true,limit:20});expect(list.items.map(w=>w.ref.id).sort()).toEqual([old.draftId,current.draftId].sort());expect(list.items.map(w=>w.baseRevision).sort()).toEqual([1,2]);
  expect((await f.r.listCorrectionMonths('scope-A',{pendingOnly:true,limit:12})).items).toMatchObject([{latestRevision:2,pendingCount:2,draftCount:2}]);
});

it('copying a closed unapplied copy retains its original source basis and raw proposal',async()=>{
 const f=await webFixture(),d=await createWebDraft(f),ref={kind:'draft' as const,id:d.draftId};
 await f.r.closeCorrectionWork('scope-A',{ref,expectedDraftRevision:1,idempotencyKey:'nested-close-original'});
 const basis={...f.neutral,basisId:crypto.randomUUID()};await f.r.putCorrectionBasis(basis);
 const copied={...d,draftId:crypto.randomUUID(),basisId:basis.basisId,content:{edits:[],reason:'',evidenceNote:''},copiedFrom:ref,originalBasisId:f.neutral.basisId,proposedContent:d.content,requiresReapply:true};
 await f.r.writeCorrectionDraft({draft:copied,expectedDraftRevision:null,expectedHead:(await f.r.currentHeads('scope-A',[month]))[0],command:{action:'copy',idempotencyKey:'nested-first',requestHash:'nested-first'}});
 const copiedRef={kind:'draft' as const,id:copied.draftId};await f.r.closeCorrectionWork('scope-A',{ref:copiedRef,expectedDraftRevision:1,idempotencyKey:'nested-close-copy'});
 const before=await f.r.getCorrectionDraft('scope-A',copied.draftId),next={...copied,draftId:crypto.randomUUID(),copiedFrom:copiedRef};
 const input={draft:next,expectedDraftRevision:null,expectedHead:(await f.r.currentHeads('scope-A',[month]))[0],command:{action:'copy' as const,idempotencyKey:'nested-second',requestHash:'nested-second'}};
 expect(await f.r.writeCorrectionDraft(input)).toEqual(next);expect(await f.r.getCorrectionDraft('scope-A',copied.draftId)).toEqual(before);
 expect(await f.r.writeCorrectionDraft({...input,expectedHead:{...input.expectedHead,revision:99}})).toEqual(next);
});
