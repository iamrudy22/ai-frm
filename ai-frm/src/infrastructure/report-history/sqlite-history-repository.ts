import { DatabaseSync, backup as onlineBackup } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, statSync, openSync, closeSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { confirmDecision } from '../../domain/report-history/report-history';
import { addMonths, parseYearMonth, type YearMonth } from '../../domain/shared/year-month';
import type * as P from '../../application/report-history/ports';
import { encodeEvidence, decodeEvidence } from './evidence-codec';
export const HISTORY_CALCULATION_VERSION = 'risk-policy-2026-09-28@e3a8f9e';
export const HISTORY_TEMPLATE_VERSION = 'report@e3a8f9e';
export function hashHistoryValue(value: unknown): string { return createHash('sha256').update(encodeEvidence(value)).digest('hex'); }
export type SqliteHistoryOptions = {
  readonly readOnly?: boolean;
  readonly now?: () => string;
  readonly nextId?: () => string;
};
const SCHEMA = `
CREATE TABLE schema_migration(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE workspace_scope(scope_id TEXT PRIMARY KEY, is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)));
CREATE UNIQUE INDEX default_scope ON workspace_scope(is_default) WHERE is_default=1;
CREATE TABLE source_capture(scope_id TEXT NOT NULL REFERENCES workspace_scope, id TEXT NOT NULL, body TEXT NOT NULL, content_hash TEXT NOT NULL, parent_id TEXT, PRIMARY KEY(scope_id,id),FOREIGN KEY(scope_id,parent_id) REFERENCES source_capture(scope_id,id));
CREATE INDEX source_content ON source_capture(scope_id,content_hash);
CREATE TABLE report_input_snapshot(scope_id TEXT NOT NULL REFERENCES workspace_scope,id TEXT NOT NULL,body TEXT NOT NULL,parent_id TEXT,PRIMARY KEY(scope_id,id),FOREIGN KEY(scope_id,parent_id) REFERENCES report_input_snapshot(scope_id,id));
CREATE TABLE backfill_batch(scope_id TEXT NOT NULL REFERENCES workspace_scope,id TEXT NOT NULL,start_key TEXT NOT NULL,request_hash TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(scope_id,id),UNIQUE(scope_id,start_key));
CREATE TABLE calculation_record(scope_id TEXT NOT NULL REFERENCES workspace_scope,id TEXT NOT NULL,body TEXT NOT NULL,parent_id TEXT,batch_id TEXT,PRIMARY KEY(scope_id,id),FOREIGN KEY(scope_id,parent_id) REFERENCES calculation_record(scope_id,id),FOREIGN KEY(scope_id,batch_id) REFERENCES backfill_batch(scope_id,id));
CREATE TABLE history_selection(scope_id TEXT NOT NULL REFERENCES workspace_scope,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(scope_id,id));
CREATE TABLE report_document(scope_id TEXT NOT NULL REFERENCES workspace_scope,id TEXT NOT NULL,content_hash TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(scope_id,id));
CREATE INDEX document_content ON report_document(scope_id,content_hash);
CREATE TABLE report_candidate(scope_id TEXT NOT NULL REFERENCES workspace_scope,id TEXT NOT NULL,body TEXT NOT NULL,input_id TEXT NOT NULL,construction_id TEXT NOT NULL,funding_id TEXT NOT NULL,selection_id TEXT NOT NULL,document_id TEXT NOT NULL,PRIMARY KEY(scope_id,id),FOREIGN KEY(scope_id,input_id) REFERENCES report_input_snapshot(scope_id,id),FOREIGN KEY(scope_id,construction_id) REFERENCES calculation_record(scope_id,id),FOREIGN KEY(scope_id,funding_id) REFERENCES calculation_record(scope_id,id),FOREIGN KEY(scope_id,selection_id) REFERENCES history_selection(scope_id,id),FOREIGN KEY(scope_id,document_id) REFERENCES report_document(scope_id,id));
CREATE TABLE monthly_confirmation(scope_id TEXT NOT NULL REFERENCES workspace_scope,id TEXT NOT NULL,report_cycle TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),candidate_id TEXT NOT NULL,previous_id TEXT,confirmed_at TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(scope_id,id),UNIQUE(scope_id,report_cycle,revision),UNIQUE(scope_id,report_cycle,candidate_id),FOREIGN KEY(scope_id,candidate_id) REFERENCES report_candidate(scope_id,id),FOREIGN KEY(scope_id,previous_id) REFERENCES monthly_confirmation(scope_id,id));
CREATE TABLE monthly_head(scope_id TEXT NOT NULL REFERENCES workspace_scope,report_cycle TEXT NOT NULL,confirmation_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(scope_id,report_cycle),FOREIGN KEY(scope_id,confirmation_id) REFERENCES monthly_confirmation(scope_id,id));
CREATE TABLE idempotent_command(scope_id TEXT NOT NULL REFERENCES workspace_scope,key TEXT NOT NULL,candidate_id TEXT NOT NULL,confirmation_id TEXT NOT NULL,PRIMARY KEY(scope_id,key),FOREIGN KEY(scope_id,candidate_id) REFERENCES report_candidate(scope_id,id),FOREIGN KEY(scope_id,confirmation_id) REFERENCES monthly_confirmation(scope_id,id));
CREATE TABLE backfill_step(scope_id TEXT NOT NULL,batch_id TEXT NOT NULL,report_cycle TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(batch_id,report_cycle),FOREIGN KEY(scope_id,batch_id) REFERENCES backfill_batch(scope_id,id));
CREATE TABLE batch_capture_slot(scope_id TEXT NOT NULL,batch_id TEXT NOT NULL,source_key TEXT NOT NULL,owner_id TEXT NOT NULL,fence INTEGER NOT NULL,lease_until TEXT NOT NULL,capture_id TEXT,PRIMARY KEY(scope_id,batch_id,source_key),FOREIGN KEY(scope_id,batch_id) REFERENCES backfill_batch(scope_id,id),FOREIGN KEY(scope_id,capture_id) REFERENCES source_capture(scope_id,id));
`;
const IMMUTABLE = ['source_capture', 'report_input_snapshot', 'calculation_record', 'history_selection', 'report_document', 'report_candidate', 'monthly_confirmation', 'idempotent_command', 'backfill_step'];
function instant(value: string): number { const n = Date.parse(value); if (!Number.isFinite(n))
  throw Error('INVALID_INSTANT'); return n; }
function assertEvaluationCalendar(input: Pick<P.CalculationWrite, 'evaluationTimeZone' | 'evaluatedAt' | 'evaluatedCalendar'>): void {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', { timeZone: input.evaluationTimeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(input.evaluatedAt));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  if (Number(fields.year) !== input.evaluatedCalendar.year || Number(fields.month) !== input.evaluatedCalendar.month || Number(fields.day) !== input.evaluatedCalendar.day)
    throw Error('EVALUATION_CALENDAR_MISMATCH');
}
function cycles(from: YearMonth, to: YearMonth): YearMonth[] { parseYearMonth(from); parseYearMonth(to); const out: YearMonth[] = []; for (let m = from; m <= to; m = addMonths(m, 1)) {
  out.push(m);
  if (out.length > 18)
    throw Error('LIMIT_EXCEEDED');
} if (!out.length)
  throw Error('INVALID_RANGE'); return out; }
function equal(a: unknown, b: unknown): boolean { return encodeEvidence(a) === encodeEvidence(b); }

function correctionAmountsMatch(original: P.StatementSnapshotDto, corrected: P.StatementSnapshotDto): boolean {
  const originalKeys = Object.keys(original.amounts).sort();
  if (!equal(originalKeys, Object.keys(corrected.amounts).sort())) return false;

  return originalKeys.every(key => {
    const item = key as keyof P.StatementSnapshotDto['amounts'];
    const before = original.amounts[item];
    const after = corrected.amounts[item];
    if (!Array.isArray(after)) return !Array.isArray(before) && equal(after, before);

    const expectedLength = Array.isArray(before) ? before.length : original.monthLabels.length;
    return after.length === expectedLength && Array.from(after).every(value => typeof value === 'number' && Number.isFinite(value));
  });
}
/** Server adapter. Each public operation is local; no network, calculations or document rendering occurs in a transaction. */
export class SqliteHistoryRepository implements P.HistoryRepository {
  readonly databasePath: string;
  private readonly db: DatabaseSync;
  private readonly now: () => string;
  private readonly nextId: () => string;
  private closed = false;
  constructor(path = join(process.cwd(), 'data', 'report-history.sqlite'), private readonly options: SqliteHistoryOptions = {}) {
    this.databasePath = resolve(path);
    this.now = options.now ?? (() => new Date().toISOString());
    this.nextId = options.nextId ?? randomUUID;
    if (!options.readOnly) {
      const folder = dirname(this.databasePath);
      if (!existsSync(folder))
        mkdirSync(folder, { recursive: true, mode: 0o700 });
      chmodSync(folder, 0o700);
      if (!existsSync(this.databasePath))
        closeSync(openSync(this.databasePath, 'wx', 0o600));
    }
    this.db = new DatabaseSync(this.databasePath, { readOnly: options.readOnly ?? false });
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
      if (version > 1)
        throw Error('UNSUPPORTED_SCHEMA_VERSION');
      if (options.readOnly) {
        if (version !== 1)
          throw Error('UNSUPPORTED_SCHEMA_VERSION');
      }
      else {
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
        if (version === 0)
          this.transaction(() => {
            // Never reinterpret an unknown existing database as our empty ledger.
            const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            if (tables.length)
              throw Error('UNKNOWN_DATABASE_SCHEMA');
            this.db.exec(SCHEMA);
            for (const table of IMMUTABLE)
              for (const op of ['UPDATE', 'DELETE'])
                this.db.exec(`CREATE TRIGGER immutable_${table}_${op.toLowerCase()} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_HISTORY'); END;`);
            this.db.prepare('INSERT INTO schema_migration VALUES(1,?)').run(this.now());
            this.db.prepare('INSERT INTO workspace_scope VALUES(?,1)').run(this.nextId());
            this.db.exec('PRAGMA user_version=1');
          });
        chmodSync(this.databasePath, 0o600);
      }
      if (this.db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
        throw Error('CORRUPT_HISTORY_DATABASE');
      if (this.db.prepare('PRAGMA foreign_key_check').all().length)
        throw Error('INVALID_HISTORY_REFERENCES');
      if (this.db.prepare('SELECT version FROM schema_migration WHERE version=1').get()?.version !== 1)
        throw Error('UNSUPPORTED_SCHEMA_VERSION');
    }
    catch (error) {
      this.db.close();
      this.closed = true;
      throw error;
    }
  }
  close(): void { if (!this.closed) {
    this.db.close();
    this.closed = true;
  } }
  private transaction<T>(work: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try {
    const result = work();
    this.db.exec('COMMIT');
    return result;
  }
  catch (error) {
    this.db.exec('ROLLBACK');
    throw error;
  } }
  private scope(scopeId: string): void { if (!scopeId.trim())
    throw Error('INVALID_SCOPE'); this.db.prepare('INSERT OR IGNORE INTO workspace_scope(scope_id) VALUES(?)').run(scopeId); }
  private read<T>(table: string, scopeId: string, id: string): T | null { const row = this.db.prepare(`SELECT body FROM ${table} WHERE scope_id=? AND id=?`).get(scopeId, id); return row ? decodeEvidence<T>(String(row.body)) : null; }
  private all<T>(table: string, scopeId: string): T[] { return this.db.prepare(`SELECT body FROM ${table} WHERE scope_id=? ORDER BY rowid`).all(scopeId).map(row => decodeEvidence<T>(String(row.body))); }
  private require<T>(table: string, scopeId: string, id: string): T { const value = this.read<T>(table, scopeId, id); if (!value)
    throw Error('NOT_FOUND_OR_WRONG_SCOPE'); return value; }
  private parent(table: string, scopeId: string, derivation: P.Derivation): void { if (derivation.kind === 'manual-correction') {
    this.require(table, scopeId, derivation.parentId);
    instant(derivation.correctedAt);
    if (!derivation.importId || !derivation.patchHash)
      throw Error('INVALID_DERIVATION');
  } }
  async defaultScopeId(): Promise<string> { const row = this.db.prepare('SELECT scope_id FROM workspace_scope WHERE is_default=1').get(); if (!row)
    throw Error('MISSING_DEFAULT_SCOPE'); return String(row.scope_id); }
  private saveEvidence(input: P.EvidenceWrite): {
    captureId: string;
  } {
    if (input.schemaVersion !== 1 || !['ecos', 'kofia'].includes(input.sourceKind))
      throw Error('UNSUPPORTED_EVIDENCE_SCHEMA');
    instant(input.receivedAt);
    this.scope(input.scopeId);
    this.parent('source_capture', input.scopeId, input.derivation);
    if (input.derivation.kind === 'manual-correction') {
      const parent = this.require<P.StoredEvidence>('source_capture', input.scopeId, input.derivation.parentId);
      if (parent.sourceKind !== input.sourceKind || parent.receivedAt !== input.receivedAt)
        throw Error('EVIDENCE_PROVENANCE_MISMATCH');
    }
    const captureId = this.nextId();
    const record: P.StoredEvidence = { ...input, captureId };
    this.db.prepare('INSERT INTO source_capture VALUES(?,?,?,?,?)').run(input.scopeId, captureId, encodeEvidence(record), input.contentHash, input.derivation.kind === 'manual-correction' ? input.derivation.parentId : null);
    return { captureId };
  }
  async putEvidence(input: P.EvidenceWrite): Promise<{
    captureId: string;
  }> { return this.transaction(() => this.saveEvidence(input)); }
  async getEvidence(scopeId: string, id: string): Promise<P.StoredEvidence | null> { return this.read('source_capture', scopeId, id); }
  async putInputSnapshot(input: P.InputSnapshotWrite): Promise<{
    inputSnapshotId: string;
  }> {
    return this.transaction(() => {
      instant(input.createdAt);
      this.scope(input.scopeId);
      this.parent('report_input_snapshot', input.scopeId, input.derivation);
      if (input.derivation.kind === 'manual-correction') {
        const parent = this.require<P.StoredInputSnapshot>('report_input_snapshot', input.scopeId, input.derivation.parentId);
        const sameStructure = input.statements.length === parent.statements.length && input.statements.every((statement, index) => {
          const original = parent.statements[index];
          return equal(statement.asOf, original.asOf) &&
            equal(statement.monthLabels, original.monthLabels) &&
            statement.baseMonthIndex === original.baseMonthIndex &&
            statement.planYearEndIndex === original.planYearEndIndex;
        });
        if (!sameStructure) throw Error('INPUT_STRUCTURE_MISMATCH');
        if (!input.statements.every((statement, index) => correctionAmountsMatch(parent.statements[index], statement)))
          throw Error('INPUT_AMOUNT_STRUCTURE_MISMATCH');
      }
      const inputSnapshotId = this.nextId();
      this.db.prepare('INSERT INTO report_input_snapshot VALUES(?,?,?,?)').run(input.scopeId, inputSnapshotId, encodeEvidence({ ...input, inputSnapshotId }), input.derivation.kind === 'manual-correction' ? input.derivation.parentId : null);
      return { inputSnapshotId };
    });
  }
  async getInputSnapshot(scopeId: string, id: string): Promise<P.StoredInputSnapshot | null> { return this.read('report_input_snapshot', scopeId, id); }
  async putCalculation(input: P.CalculationWrite): Promise<{
    calculationId: string;
  }> {
    return this.transaction(() => {
      this.scope(input.scopeId);
      parseYearMonth(input.effectiveMonth);
      instant(input.createdAt);
      instant(input.evaluatedAt);
      if (input.calculationVersion !== HISTORY_CALCULATION_VERSION)
        throw Error('UNSUPPORTED_CALCULATION_VERSION');
      if (input.evaluationClockTrace.length === 0 || input.evaluationClockTrace[0] !== input.evaluatedAt)
        throw Error('INVALID_CLOCK_TRACE');
      for (const at of input.evaluationClockTrace)
        instant(at);
      assertEvaluationCalendar(input);
      if (!['construction', 'funding'].includes(input.indicator) || !['live', 'reconstructed'].includes(input.origin))
        throw Error('INVALID_CALCULATION');
      for (const id of input.captureIds)
        this.require('source_capture', input.scopeId, id);
      this.parent('calculation_record', input.scopeId, input.derivation);
      if (input.derivation.kind === 'manual-correction') {
        const parent = this.require<P.StoredCalculation>('calculation_record', input.scopeId, input.derivation.parentId);
        if (parent.origin !== input.origin || parent.indicator !== input.indicator || parent.effectiveMonth !== input.effectiveMonth || parent.evaluatedAt !== input.evaluatedAt || !equal(parent.evaluationClockTrace, input.evaluationClockTrace) || !equal(parent.evaluatedCalendar, input.evaluatedCalendar) || parent.evaluationTimeZone !== input.evaluationTimeZone)
          throw Error('DERIVATION_CONTEXT_MISMATCH');
      }
      if (input.batchId) {
        this.require<P.StoredBatch>('backfill_batch', input.scopeId, input.batchId);
        if (input.origin !== 'reconstructed')
          throw Error('BATCH_CONTEXT_MISMATCH');
      }
      const calculationId = this.nextId();
      this.db.prepare('INSERT INTO calculation_record VALUES(?,?,?,?,?)').run(input.scopeId, calculationId, encodeEvidence({ ...input, calculationId }), input.derivation.kind === 'manual-correction' ? input.derivation.parentId : null, input.batchId ?? null);
      return { calculationId };
    });
  }
  async getCalculation(scopeId: string, id: string): Promise<P.StoredCalculation | null> { return this.read('calculation_record', scopeId, id); }
  private validateCandidate(input: P.CandidateWrite): void {
    if (input.correctionPreviewId !== null)
      throw Error('CORRECTION_PREVIEW_NOT_SUPPORTED_IN_SCHEMA_1');
    if (confirmDecision(input.basis, 0, 0).kind !== 'create')
      throw Error('INVALID_BASIS');
    instant(input.authoredAt);
    instant(input.preparedAt);
    const snapshot = this.require<P.StoredInputSnapshot>('report_input_snapshot', input.scopeId, input.inputSnapshotId);
    if (snapshot.inputHash !== input.inputHash)
      throw Error('INPUT_HASH_MISMATCH');
    for (const indicator of ['construction', 'funding'] as const) {
      const c = this.require<P.StoredCalculation>('calculation_record', input.scopeId, input.calculationIds[indicator]);
      if (c.indicator !== indicator || c.inputHash !== input.calculationInputHashes[indicator] || c.calculationVersion !== input.calculationVersion || c.effectiveMonth !== (indicator === 'construction' ? input.basis.constructionBaseMonth : input.basis.fundingObservedMonth))
        throw Error('CALCULATION_CONTEXT_MISMATCH');
    }
    const selection = this.require<P.ExternalHistorySelection>('history_selection', input.scopeId, input.historySelectionId);
    if (selection.calculationVersion !== input.calculationVersion || selection.anchors.construction !== input.basis.constructionBaseMonth || selection.anchors.funding !== input.basis.fundingObservedMonth || !equal(selection.historyCalculationIds, input.document.historyCalculationIds))
      throw Error('HISTORY_SELECTION_MISMATCH');
    if (input.document.templateVersion !== HISTORY_TEMPLATE_VERSION)
      throw Error('UNSUPPORTED_TEMPLATE_VERSION');
    if (input.document.schemaVersion !== 1 || !input.document.contentHash)
      throw Error('INVALID_DOCUMENT');
    encodeEvidence(input.document);
  }
  async putCandidate(input: P.CandidateWrite): Promise<{
    candidateId: string;
    documentHash: string;
  }> {
    return this.transaction(() => {
      this.validateCandidate(input);
      const candidateId = this.nextId(), documentHash = input.document.contentHash, documentBody = encodeEvidence(input.document);
      const identical = this.db.prepare('SELECT id FROM report_document WHERE scope_id=? AND content_hash=? AND body=?').get(input.scopeId, documentHash, documentBody);
      const documentId = identical ? String(identical.id) : this.nextId();
      if (!identical)
        this.db.prepare('INSERT INTO report_document VALUES(?,?,?,?)').run(input.scopeId, documentId, documentHash, documentBody);
      this.db.prepare('INSERT INTO report_candidate VALUES(?,?,?,?,?,?,?,?)').run(input.scopeId, candidateId, encodeEvidence({ ...input, candidateId, documentHash }), input.inputSnapshotId, input.calculationIds.construction, input.calculationIds.funding, input.historySelectionId, documentId);
      return { candidateId, documentHash };
    });
  }
  async getCandidate(scopeId: string, id: string): Promise<P.StoredCandidate | null> { return this.read('report_candidate', scopeId, id); }
  async commitConfirmation(scopeId: string, cmd: P.ConfirmationCommand): Promise<P.ConfirmationResult> {
    return this.transaction(() => {
      if (!cmd.idempotencyKey.trim())
        return { kind: 'not-ready', reason: 'IDEMPOTENCY_KEY_REQUIRED' };
      const previousCommand = this.db.prepare('SELECT candidate_id,confirmation_id FROM idempotent_command WHERE scope_id=? AND key=?').get(scopeId, cmd.idempotencyKey);
      if (previousCommand) {
        if (previousCommand.candidate_id !== cmd.candidateId)
          return { kind: 'conflict', reason: 'IDEMPOTENCY_KEY_REUSED' };
        const confirmed = this.require<P.StoredConfirmation>('monthly_confirmation', scopeId, String(previousCommand.confirmation_id));
        return { kind: 'already-confirmed', confirmationId: confirmed.confirmationId, revision: confirmed.revision };
      }
      const candidate = this.read<P.StoredCandidate>('report_candidate', scopeId, cmd.candidateId);
      if (!candidate)
        return { kind: 'not-ready', reason: 'CANDIDATE_NOT_FOUND' };
      this.validateCandidate(candidate);
      const existing = this.db.prepare('SELECT id,revision FROM monthly_confirmation WHERE scope_id=? AND report_cycle=? AND candidate_id=?').get(scopeId, candidate.basis.reportCycle, candidate.candidateId);
      if (existing) {
        this.db.prepare('INSERT INTO idempotent_command VALUES(?,?,?,?)').run(scopeId, cmd.idempotencyKey, cmd.candidateId, existing.id as string);
        return { kind: 'already-confirmed', confirmationId: String(existing.id), revision: Number(existing.revision) };
      }
      const head = this.db.prepare('SELECT confirmation_id,revision FROM monthly_head WHERE scope_id=? AND report_cycle=?').get(scopeId, candidate.basis.reportCycle);
      const decision = confirmDecision(candidate.basis, Number(head?.revision ?? 0), cmd.expectedRevision, cmd.correctionReason);
      if (decision.kind !== 'create')
        return decision;
      const confirmationId = this.nextId(), confirmedAt = this.now();
      instant(confirmedAt);
      const record: P.StoredConfirmation = { confirmationId, scopeId, reportCycle: candidate.basis.reportCycle, revision: decision.revision, confirmedAt, candidateId: candidate.candidateId, previousConfirmationId: head ? String(head.confirmation_id) : null, basis: candidate.basis, canonicalCurrentCalculationIds: candidate.calculationIds, historySelectionId: candidate.historySelectionId, document: candidate.document, ...(cmd.correctionReason?.trim() ? { correctionReason: cmd.correctionReason.trim() } : {}) };
      this.db.prepare('INSERT INTO monthly_confirmation VALUES(?,?,?,?,?,?,?,?)').run(scopeId, confirmationId, record.reportCycle, record.revision, cmd.candidateId, record.previousConfirmationId, confirmedAt, encodeEvidence(record));
      this.db.prepare('INSERT INTO monthly_head VALUES(?,?,?,?) ON CONFLICT(scope_id,report_cycle) DO UPDATE SET confirmation_id=excluded.confirmation_id,revision=excluded.revision').run(scopeId, record.reportCycle, confirmationId, record.revision);
      this.db.prepare('INSERT INTO idempotent_command VALUES(?,?,?,?)').run(scopeId, cmd.idempotencyKey, cmd.candidateId, confirmationId);
      return { kind: 'confirmed', confirmationId, revision: record.revision };
    });
  }
  async getConfirmation(scopeId: string, id: string): Promise<P.StoredConfirmation | null> { return this.read('monthly_confirmation', scopeId, id); }
  async listConfirmations(scopeId: string, cycle?: YearMonth): Promise<readonly P.ConfirmationSummary[]> { return this.all<P.StoredConfirmation>('monthly_confirmation', scopeId).filter(c => !cycle || c.reportCycle === cycle).map(c => ({ confirmationId: c.confirmationId, reportCycle: c.reportCycle, revision: c.revision, confirmedAt: c.confirmedAt, candidateId: c.candidateId, ...(c.correctionReason ? { correctionReason: c.correctionReason } : {}) })); }
  async listCalculations(query: P.HistoryQuery): Promise<readonly P.StoredCalculation[]> {
    parseYearMonth(query.from);
    parseYearMonth(query.to);
    const cutoff = instant(query.asOf);
    if (query.from > query.to)
      throw Error('INVALID_RANGE');
    const adopted = new Set<string>();
    if (query.selectedBackfillBatchId) {
      this.require('backfill_batch', query.scopeId, query.selectedBackfillBatchId);
      const steps = this.db.prepare('SELECT body FROM backfill_step WHERE scope_id=? AND batch_id=?').all(query.scopeId, query.selectedBackfillBatchId);
      for (const row of steps)
        for (const id of Object.values(decodeEvidence<P.BatchStepWrite>(String(row.body)).calculationIds)) adopted.add(id);
    }
    return this.all<P.StoredCalculation>('calculation_record', query.scopeId).filter(c => c.indicator === query.indicator && c.effectiveMonth >= query.from && c.effectiveMonth <= query.to && c.calculationVersion === query.calculationVersion && instant(c.createdAt) <= cutoff && (c.origin === 'live' || (c.batchId === query.selectedBackfillBatchId && adopted.has(c.calculationId))));
  }
  async createHistorySelection(query: P.HistorySelectionQuery): Promise<P.ExternalHistorySelection> {
    return this.transaction(() => {
      this.scope(query.scopeId);
      const cutoff = instant(query.asOf);
      if (confirmDecision(query.basis, 0, 0).kind !== 'create')
        throw Error('INVALID_BASIS');
      if (query.calculationVersion !== HISTORY_CALCULATION_VERSION)
        throw Error('UNSUPPORTED_CALCULATION_VERSION');
      const heads = new Map<YearMonth, P.StoredConfirmation>();
      for (const c of this.all<P.StoredConfirmation>('monthly_confirmation', query.scopeId)) {
        if (c.reportCycle > query.basis.reportCycle || instant(c.confirmedAt) > cutoff)
          continue;
        const prior = heads.get(c.reportCycle);
        if (!prior || prior.revision < c.revision)
          heads.set(c.reportCycle, c);
      }
      const chosen = new Map<string, P.StoredCalculation>();
      const use = (calculation: P.StoredCalculation, replace: boolean) => {
        const anchor = calculation.indicator === 'construction'
          ? query.basis.constructionBaseMonth
          : query.basis.fundingObservedMonth;
        if (
          calculation.effectiveMonth < addMonths(anchor, -17) ||
          calculation.effectiveMonth > anchor ||
          calculation.calculationVersion !== query.calculationVersion ||
          instant(calculation.createdAt) > cutoff
        ) return;

        const key = `${calculation.indicator}:${calculation.effectiveMonth}`;
        if (replace || !chosen.has(key)) chosen.set(key, calculation);
      };
      if (query.selectedBackfillBatchId) {
        const batch = this.require<P.StoredBatch>('backfill_batch', query.scopeId, query.selectedBackfillBatchId);
        if (batch.fromCycle > query.basis.reportCycle || batch.toCycle > query.basis.reportCycle || instant(batch.fixedNow) > cutoff)
          throw Error('BATCH_RANGE_MISMATCH');
        const steps = this.db.prepare('SELECT body FROM backfill_step WHERE scope_id=? AND batch_id=? ORDER BY report_cycle').all(query.scopeId, batch.batchId);
        for (const row of steps) {
          const step = decodeEvidence<P.BatchStepWrite>(String(row.body));
          for (const id of Object.values(step.calculationIds)) {
            const c = this.require<P.StoredCalculation>('calculation_record', query.scopeId, id);
            if (c.calculationVersion !== query.calculationVersion)
              throw Error('BATCH_VERSION_MISMATCH');
            use(c, false);
          }
        }
      }
      for (const head of [...heads.values()].sort((a, b) => a.reportCycle.localeCompare(b.reportCycle)))
        for (const id of Object.values(head.canonicalCurrentCalculationIds))
          use(this.require<P.StoredCalculation>('calculation_record', query.scopeId, id), true);
      const calculations = [...chosen.values()].sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth) || a.indicator.localeCompare(b.indicator));
      const selectedIds = new Set(calculations.map(c => c.calculationId));
      const headRevisions = [...heads.values()]
        .filter(h => h.reportCycle <= query.basis.reportCycle && Object.values(h.canonicalCurrentCalculationIds).some(id => selectedIds.has(id)))
        .map(h => ({ reportCycle: h.reportCycle, confirmationId: h.confirmationId, revision: h.revision }))
        .sort((a, b) => a.reportCycle.localeCompare(b.reportCycle));
      const selection: P.ExternalHistorySelection = { historySelectionId: this.nextId(), scopeId: query.scopeId, calculationVersion: query.calculationVersion, anchors: { construction: query.basis.constructionBaseMonth, funding: query.basis.fundingObservedMonth }, cutoff: query.asOf, selectedBackfillBatchId: query.selectedBackfillBatchId, headRevisions, calculations, historyCalculationIds: calculations.map(c => c.calculationId) };
      this.db.prepare('INSERT INTO history_selection VALUES(?,?,?)').run(query.scopeId, selection.historySelectionId, encodeEvidence(selection));
      return selection;
    });
  }
  async getHistorySelection(scopeId: string, id: string): Promise<P.ExternalHistorySelection | null> { return this.read('history_selection', scopeId, id); }
  async putBatch(input: P.BatchWrite): Promise<{
    batchId: string;
  }> {
    return this.transaction(() => {
      this.scope(input.scopeId);
      instant(input.fixedNow);
      assertEvaluationCalendar({ evaluatedAt: input.fixedNow, evaluatedCalendar: input.evaluatedCalendar, evaluationTimeZone: input.evaluationTimeZone });
      const pendingCycles = cycles(input.fromCycle, input.toCycle);
      const requestHash = hashHistoryValue({ scopeId: input.scopeId, startKey: input.startKey, fromCycle: input.fromCycle, toCycle: input.toCycle, inputHash: input.inputHash, roundEntriesJson: input.roundEntriesJson });
      const existing = this.db.prepare('SELECT id,request_hash FROM backfill_batch WHERE scope_id=? AND start_key=?').get(input.scopeId, input.startKey);
      if (existing) {
        if (existing.request_hash !== requestHash)
          throw Error('BATCH_START_KEY_CONFLICT');
        return { batchId: String(existing.id) };
      }
      const batchId = this.nextId(), record: P.StoredBatch = { ...input, batchId, completedCycles: [], pendingCycles, status: 'pending-source' };
      this.db.prepare('INSERT INTO backfill_batch VALUES(?,?,?,?,?)').run(input.scopeId, batchId, input.startKey, requestHash, encodeEvidence(record));
      return { batchId };
    });
  }
  async getBatch(scopeId: string, id: string): Promise<P.StoredBatch | null> { return this.read('backfill_batch', scopeId, id); }
  async listBatches(scopeId: string, status: 'active' | 'all', limit: number): Promise<readonly P.StoredBatch[]> { if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw Error('LIMIT_EXCEEDED');
    return this.db.prepare('SELECT body FROM backfill_batch WHERE scope_id=? ORDER BY rowid DESC').all(scopeId)
      .map(row => decodeEvidence<P.StoredBatch>(String(row.body)))
      .filter(b => status === 'all' || b.status !== 'completed').slice(0, limit);
  }
  async commitBatchStep(input: P.BatchStepWrite): Promise<P.StoredBatch> {
    return this.transaction(() => {
      const batch = this.require<P.StoredBatch>('backfill_batch', input.scopeId, input.batchId);
      if (confirmDecision(input.basis, 0, 0).kind !== 'create' || input.basis.reportCycle !== input.reportCycle)
        throw Error('BATCH_BASIS_MISMATCH');
      const prior = this.db.prepare('SELECT body FROM backfill_step WHERE scope_id=? AND batch_id=? AND report_cycle=?').get(input.scopeId, input.batchId, input.reportCycle);
      if (prior) {
        if (!equal(decodeEvidence(String(prior.body)), input))
          throw Error('BATCH_STEP_CONFLICT');
        return batch;
      }
      if (!batch.pendingCycles.includes(input.reportCycle))
        throw Error('BATCH_CYCLE_OUT_OF_RANGE');
      for (const indicator of ['construction', 'funding'] as const) {
        const c = this.require<P.StoredCalculation>('calculation_record', input.scopeId, input.calculationIds[indicator]);
        if (c.indicator !== indicator || c.batchId !== input.batchId || c.effectiveMonth !== (indicator === 'construction' ? input.basis.constructionBaseMonth : input.basis.fundingObservedMonth))
          throw Error('BATCH_CALCULATION_MISMATCH');
      }
      this.db.prepare('INSERT INTO backfill_step VALUES(?,?,?,?)').run(input.scopeId, input.batchId, input.reportCycle, encodeEvidence(input));
      const pendingCycles = batch.pendingCycles.filter(c => c !== input.reportCycle), record: P.StoredBatch = { ...batch, completedCycles: [...batch.completedCycles, input.reportCycle].sort(), pendingCycles, status: pendingCycles.length ? 'running' : 'completed' };
      this.db.prepare('UPDATE backfill_batch SET body=? WHERE scope_id=? AND id=?').run(encodeEvidence(record), input.scopeId, input.batchId);
      return record;
    });
  }
  async claimCaptureSlot(input: P.CaptureClaim): Promise<P.CaptureClaimResult> {
    return this.transaction(() => {
      this.require('backfill_batch', input.scopeId, input.batchId);
      if (!/^(ecos|kofia:\d{4}\/(0[1-9]|1[0-2]))$/.test(input.sourceKey) || !input.ownerId.trim())
        throw Error('INVALID_CAPTURE_SLOT');
      if (instant(input.leaseUntil) - instant(input.now) !== 90000)
        throw Error('LEASE_MUST_BE_90_SECONDS');
      const row = this.db.prepare('SELECT * FROM batch_capture_slot WHERE scope_id=? AND batch_id=? AND source_key=?').get(input.scopeId, input.batchId, input.sourceKey);
      if (row?.capture_id)
        return { kind: 'ready', captureId: String(row.capture_id) };
      if (row && instant(String(row.lease_until)) > instant(input.now))
        return { kind: 'busy' };
      const fence = Number(row?.fence ?? 0) + 1;
      this.db.prepare('INSERT INTO batch_capture_slot VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(scope_id,batch_id,source_key) DO UPDATE SET owner_id=excluded.owner_id,fence=excluded.fence,lease_until=excluded.lease_until').run(input.scopeId, input.batchId, input.sourceKey, input.ownerId, fence, input.leaseUntil);
      return { kind: 'claimed', fence };
    });
  }
  async completeCaptureSlot(input: P.CaptureCompletion): Promise<{
    kind: 'saved';
    captureId: string;
  } | {
    kind: 'stale';
  }> {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM batch_capture_slot WHERE scope_id=? AND batch_id=? AND source_key=?').get(input.scopeId, input.batchId, input.sourceKey);
      if (!row || row.owner_id !== input.ownerId || Number(row.fence) !== input.fence)
        return { kind: 'stale' };
      if (row.capture_id)
        return { kind: 'saved', captureId: String(row.capture_id) };
      if (input.evidence.scopeId !== input.scopeId || input.evidence.sourceKind !== (input.sourceKey === 'ecos' ? 'ecos' : 'kofia'))
        throw Error('CAPTURE_SCOPE_OR_SOURCE_MISMATCH');
      const { captureId } = this.saveEvidence(input.evidence);
      this.db.prepare('UPDATE batch_capture_slot SET capture_id=? WHERE scope_id=? AND batch_id=? AND source_key=? AND fence=?').run(captureId, input.scopeId, input.batchId, input.sourceKey, input.fence);
      return { kind: 'saved', captureId };
    });
  }
  /** Trusted server code only: no caller-controlled destination. Use online backup, never copy a live WAL database. */
  async backup(): Promise<string> { if (this.options.readOnly)
    throw Error('READ_ONLY_HISTORY'); const folder = join(dirname(this.databasePath), 'backups'); mkdirSync(folder, { recursive: true, mode: 0o700 }); chmodSync(folder, 0o700); const stamp = new Date(this.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); const destination = join(folder, `report-history-${stamp}-${this.nextId()}.sqlite`); closeSync(openSync(destination, 'wx', 0o600)); try {
    await onlineBackup(this.db, destination);
  }
  catch (error) {
    rmSync(destination, { force: true });
    throw error;
  } chmodSync(destination, 0o600); if (!statSync(destination).isFile())
    throw Error('BACKUP_UNAVAILABLE'); return destination; }
}
