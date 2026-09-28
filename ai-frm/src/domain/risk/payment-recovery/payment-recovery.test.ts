import { describe, it, expect } from 'vitest';
import { assessPaymentRecovery, paymentRecoveryInputFrom } from '@/domain/risk/payment-recovery/payment-recovery';
import { createStatement, type StatementInput } from '@/domain/cashflow/statement';
import { amount } from '@/domain/shared/amount';

const given = (plan: number, actual: number) =>
  assessPaymentRecovery({ plan: amount(plan), actual: amount(actual) });

describe('대금 회수 위험 판정', () => {
  it('회의록 사례 — 계획 5만에 실적 4만이면 0.8, 주의', () => {
    const r = given(50000, 40000);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.rate).toBeCloseTo(0.8, 10);
    expect(r.grade).toBe('주의');
  });

  it('회의록 사례 — 실적 6만이면 1.2, 정상', () => {
    const r = given(50000, 60000);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.grade).toBe('정상');
  });

  it('계획값이 0이면 판정하지 않는다', () => {
    expect(given(0, 100).kind).toBe('invalid');
  });

  it('계획값이 음수면 판정하지 않는다 — 부호가 뒤집혀 엉뚱한 등급이 나온다', () => {
    expect(given(-50000, 40000).kind).toBe('invalid');
  });
});

describe('두 회차에서 입력 조립', () => {
  function statementAt(asOf: Date, baseMonthIndex: number, 분양회수: number[]): StatementInput {
    const labels = ['6월', '7월', '8월', '9월', '10월'];
    const zeros = labels.map(() => amount(0));
    return {
      asOf,
      monthLabels: labels,
      baseMonthIndex,
      planYearEndIndex: labels.length - 1,
      amounts: {
        기초시재: zeros,
        수입계: zeros,
        // 분양회수가 아닌 행을 집으면 바로 드러나도록 다른 값을 넣어 둔다.
        수입: labels.map(() => amount(11111)),
        분양회수: 분양회수.map(amount),
        기타수입: zeros,
        지출: zeros,
      },
    };
  }

  // 7월 회차: 기준월 7월. 7월 분양회수 값은 계획이다.
  const july = createStatement(statementAt(new Date(2026, 6, 8), 1, [0, 50000, 0, 0, 0]));
  // 8월 회차: 기준월 8월. 직전 달인 7월 값은 이제 실적이다.
  const august = createStatement(statementAt(new Date(2026, 7, 10), 2, [0, 40000, 0, 0, 0]));

  it('수입이 아니라 분양회수를 읽는다', () => {
    const input = paymentRecoveryInputFrom(july, august);
    expect(input.plan).toBe(50000);
    expect(input.actual).toBe(40000);
    expect(input.plan).not.toBe(11111);
    expect(input.actual).not.toBe(11111);
  });

  it('이전 회차의 기준월 = 최신 회차의 직전 월이 판정 대상이다', () => {
    const input = paymentRecoveryInputFrom(july, august);
    expect(input.plan).toBe(50000);
    expect(input.actual).toBe(40000);
    expect(input.targetMonthLabel).toBe('7월');
  });

  it('조립한 입력이 0.8 주의로 이어진다', () => {
    const r = assessPaymentRecovery(paymentRecoveryInputFrom(july, august));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.grade).toBe('주의');
  });

  it('최신 회차의 기준월이 첫 달이면 직전 월이 없다', () => {
    const noPrior = createStatement(statementAt(new Date(2026, 5, 9), 0, [0, 0, 0, 0, 0]));
    expect(() => paymentRecoveryInputFrom(july, noPrior)).toThrow(/직전/);
  });

  // 회차를 건너뛰면 6월 회차의 계획(6월)과 8월 회차의 실적(7월)을 맞대게 된다.
  // 다른 달끼리의 비율은 회수율이 아니므로 등급을 내지 않는다.
  it('회차를 건너뛰면 서로 다른 달을 비교하게 되므로 판정하지 않는다', () => {
    const june = createStatement(statementAt(new Date(2026, 5, 9), 0, [50000, 0, 0, 0, 0]));
    expect(() => paymentRecoveryInputFrom(june, august)).toThrow(/연속/);
  });

  it('회차 순서가 뒤바뀌면 판정하지 않는다 — 계획과 실적이 뒤집힌다', () => {
    const september = createStatement(statementAt(new Date(2026, 8, 9), 3, [0, 0, 40000, 0, 0]));
    expect(() => paymentRecoveryInputFrom(september, august)).toThrow(/연속/);
  });

  // 12개월 떨어진 회차는 라벨('7월')만 보면 같은 달처럼 보인다. 달력으로도 확인해야 한다.
  it('라벨이 같아도 1년 떨어진 회차는 같은 달이 아니다', () => {
    const nextYearAugust = createStatement(statementAt(new Date(2027, 7, 10), 2, [0, 40000, 0, 0, 0]));
    expect(() => paymentRecoveryInputFrom(july, nextYearAugust)).toThrow(/연속/);
  });

  // 기준일은 연속인데 기준월 열이 기준일과 어긋난 회차. 판독 계층은 이를 막지만
  // 회차 애그리거트는 둘을 따로 받으므로, 조립 단계에서도 같은 달인지 확인한다.
  it('기준일이 연속이어도 비교 대상 열이 다른 달이면 판정하지 않는다', () => {
    const misaligned = createStatement(statementAt(new Date(2026, 6, 8), 2, [0, 50000, 0, 0, 0]));
    expect(() => paymentRecoveryInputFrom(misaligned, august)).toThrow(/같은 달/);
  });
});
