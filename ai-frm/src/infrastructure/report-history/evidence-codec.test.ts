import { describe, expect, it } from 'vitest';
import { decodeEvidence, encodeEvidence, statementToDto, statementFromDto } from './evidence-codec';
import { amount } from '../../domain/shared/amount';
import type { StatementInput } from '../../domain/cashflow/statement';
describe('손실 없는 증거 codec', () => {
  it('0·음수·소수·Map 순서·계열 시각/단위·실패 및 태그와 닮은 JSON을 보존한다', () => {
    const original = { a: new Map([['2026/09', 0], ['2026/07', -1.0000000000000002], ['2026/08', 0.1234567890123456]]), fetchedAt: new Date('2026-10-01T00:00:00.123Z'), unit: '억원', error: { error: '조회 실패' }, nested: { $type: 'date', value: 'plain' }, negativeZero: -0 };
    const restored = decodeEvidence<typeof original>(encodeEvidence(original));
    expect(restored).toEqual(original);
    expect([...restored.a]).toEqual([...original.a]);
    expect(Object.is(restored.negativeZero, -0)).toBe(true);
  });
  it('전체 StatementInput을 local calendar로 복원하며 unreadable을 0으로 채우지 않는다', () => {
    const input: StatementInput = { asOf: new Date(2026, 8, 30), monthLabels: ['8월', '9월'], baseMonthIndex: 1, planYearEndIndex: 1, amounts: { 기초시재: [amount(0), amount(-2.345678901234)], 수입계: [amount(1), amount(2)], 수입: { unreadable: '행 누락' }, 분양회수: [amount(3), amount(4)], 기타수입: [amount(0), amount(0)], 지출: [amount(5), amount(6)] } };
    expect(statementFromDto(decodeEvidence(encodeEvidence(statementToDto(input))))).toEqual(input);
  });
  it.each([NaN, Infinity, -Infinity, undefined, () => 1])('지원하지 않는 값을 조용히 변형하지 않는다: %s', value => {
    expect(() => encodeEvidence({ value })).toThrow();
  });
  it('희소 숫자 배열의 빈 칸을 null로 바꾸지 않고 거부한다', () => {
    expect(() => encodeEvidence({ amounts: new Array<number>(2) })).toThrow('UNSUPPORTED_EVIDENCE_VALUE');
  });
  it('버전과 손상된 payload를 검사한다', () => {
    expect(() => decodeEvidence('{')).toThrow();
    expect(() => decodeEvidence('{"schemaVersion":2,"value":null}')).toThrow();
  });
});
