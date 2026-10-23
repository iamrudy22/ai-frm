import type { StatementInput } from '../../domain/cashflow/statement';
import type { StatementSnapshotDto, JsonValue } from '../../application/report-history/ports';
import { amount } from '../../domain/shared/amount';
/** Every object is tagged structurally, so user payload keys cannot collide with codec tags. */
function pack(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw Error('NON_FINITE_NUMBER');
    return Object.is(value, -0) ? ['negative-zero'] : value;
  }
  if (typeof value !== 'object')
    throw Error('UNSUPPORTED_EVIDENCE_VALUE');
  if (ancestors.has(value))
    throw Error('CYCLIC_EVIDENCE');
  ancestors.add(value);
  try {
    if (value instanceof Date) {
      if (!Number.isFinite(value.getTime()))
        throw Error('INVALID_DATE');
      return ['date', value.toISOString()];
    }
    if (value instanceof Map)
      return ['map', [...value].map(([k, v]) => [pack(k, ancestors), pack(v, ancestors)])];
    if (Array.isArray(value))
      return ['array', Array.from(value).map(v => pack(v, ancestors))];
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw Error('UNSUPPORTED_EVIDENCE_OBJECT');
    return ['object', Object.keys(value).sort().map(k => [k, pack((value as Record<string, unknown>)[k], ancestors)])];
  }
  finally {
    ancestors.delete(value);
  }
}
function unpack(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value))
    return value;
  if (!Array.isArray(value))
    throw Error('INVALID_EVIDENCE');
  const [tag, data] = value;
  if (tag === 'negative-zero' && value.length === 1)
    return -0;
  if (value.length !== 2)
    throw Error('INVALID_EVIDENCE');
  if (tag === 'date' && typeof data === 'string') {
    const d = new Date(data);
    if (d.toISOString() !== data)
      throw Error('INVALID_DATE');
    return d;
  }
  if (!Array.isArray(data))
    throw Error('INVALID_EVIDENCE');
  if (tag === 'array')
    return data.map(unpack);
  if (tag === 'object' || tag === 'map') {
    const entries = data.map((entry: unknown) => { if (!Array.isArray(entry) || entry.length !== 2)
      throw Error('INVALID_EVIDENCE_ENTRY'); return [tag === 'object' ? entry[0] : unpack(entry[0]), unpack(entry[1])] as [
      unknown,
      unknown
    ]; });
    if (tag === 'map')
      return new Map(entries);
    const out: Record<string, unknown> = {};
    for (const [key, v] of entries) {
      if (typeof key !== 'string' || Object.hasOwn(out, key))
        throw Error('INVALID_EVIDENCE_KEY');
      Object.defineProperty(out, key, { value: v, enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  throw Error('INVALID_EVIDENCE_TAG');
}
export function encodeEvidence(value: unknown): string { return JSON.stringify({ schemaVersion: 1, value: pack(value) }); }
export function decodeEvidence<T = unknown>(text: string): T { const envelope = JSON.parse(text); if (envelope?.schemaVersion !== 1 || !Object.hasOwn(envelope, 'value'))
  throw Error('UNSUPPORTED_EVIDENCE_SCHEMA'); return unpack(envelope.value) as T; }
/** JSON envelope suitable for EvidenceWrite.payloadJson. Map entry order, Dates and units survive. */
export function evidenceToJson(value: unknown): JsonValue { return JSON.parse(encodeEvidence(value)) as JsonValue; }
export function evidenceFromJson<T = unknown>(value: JsonValue): T { return decodeEvidence<T>(JSON.stringify(value)); }
export function statementToDto(input: StatementInput): StatementSnapshotDto {
  const result = { asOf: { year: input.asOf.getFullYear(), month: input.asOf.getMonth() + 1, day: input.asOf.getDate() }, monthLabels: [...input.monthLabels], baseMonthIndex: input.baseMonthIndex, planYearEndIndex: input.planYearEndIndex, amounts: input.amounts };
  return decodeEvidence<StatementSnapshotDto>(encodeEvidence(result));
}
export function statementFromDto(dto: StatementSnapshotDto): StatementInput {
  const { year, month, day } = dto.asOf, asOf = new Date(year, month - 1, day);
  if (asOf.getFullYear() !== year || asOf.getMonth() + 1 !== month || asOf.getDate() !== day)
    throw Error('INVALID_STATEMENT_CALENDAR');
  const amounts = Object.fromEntries(Object.entries(dto.amounts).map(([key, value]) => [key, Array.isArray(value) ? value.map(amount) : { ...value }])) as StatementInput['amounts'];
  return { asOf, monthLabels: [...dto.monthLabels], baseMonthIndex: dto.baseMonthIndex, planYearEndIndex: dto.planYearEndIndex, amounts };
}
