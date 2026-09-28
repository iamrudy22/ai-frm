import { describe, it, expect } from 'vitest';
import { assessLiquidityGap, liquidityGapInputFrom } from '@/domain/risk/liquidity-gap/liquidity-gap';
import { createStatement } from '@/domain/cashflow/statement';
import { amount, toPercent } from '@/domain/shared/amount';

const given = (openingCash: number, income: number, expense: number) =>
  assessLiquidityGap({
    openingCash: amount(openingCash),
    income: amount(income),
    expense: amount(expense),
  });

describe('유동성 Gap 판정', () => {
  it('회의록의 169% 사례를 재현한다', () => {
    // 실수치가 아니라 같은 비율을 내는 합성값이다.
    const r = given(1690, 700, 1700);
    expect(r.kind).toBe('gap');
    if (r.kind !== 'gap') return;
    expect(r.netOutflow).toBe(1000);
    expect(toPercent(r.gapRatio)).toBeCloseTo(169, 10);
    expect(r.grade).toBe('정상');
  });

  it('순유입이면 유동성 압박이 없다', () => {
    // 이전 구현은 Math.abs로 순유입을 순유출로 뒤집어 '위기'를 냈다.
    const r = given(100, 2000, 800);
    expect(r.kind).toBe('net-inflow');
    expect(r.grade).toBe('정상');
  });

  it('순지출이 0이면 오류가 아니라 가장 안전한 상태다', () => {
    const r = given(100, 1700, 1700);
    expect(r.kind).toBe('net-inflow');
    expect(r.grade).toBe('정상');
  });

  it('시재가 없으면 위기다', () => {
    const r = given(0, 700, 1700);
    expect(r.kind).toBe('gap');
    if (r.kind !== 'gap') return;
    expect(r.gapRatio).toBe(0);
    expect(r.grade).toBe('위기');
  });

  it('시재가 마이너스여도 판정한다', () => {
    const r = given(-500, 700, 1700);
    expect(r.grade).toBe('위기');
  });

  it('경계값 0.5는 정상에 포함된다', () => {
    const r = given(500, 700, 1700);
    expect(r.grade).toBe('정상');
  });
});

describe('회차에서 입력 조립', () => {
  const statement = createStatement({
    asOf: new Date(2026, 7, 10),
    monthLabels: ['7월', '8월', '9월', '10월', '11월'],
    baseMonthIndex: 1, // 8월
    planYearEndIndex: 4, // 11월 — 이 테스트에서는 창 판정에 쓰이지 않는다
    amounts: {
      기초시재: [amount(1), amount(1690), amount(2), amount(3), amount(4)],
      수입계: [amount(0), amount(0), amount(0), amount(0), amount(0)],
      수입: [amount(999), amount(300), amount(200), amount(200), amount(999)],
      분양회수: [amount(0), amount(0), amount(0), amount(0), amount(0)],
      기타수입: [amount(0), amount(0), amount(0), amount(0), amount(0)],
      지출: [amount(999), amount(600), amount(600), amount(500), amount(999)],
    },
  });

  it('기초시재는 기준월 것만, 수입·지출은 3개월 합계다', () => {
    const input = liquidityGapInputFrom(statement, statement.defaultBaseMonth);
    expect(input.openingCash).toBe(1690);
    expect(input.income).toBe(700); // 300 + 200 + 200
    expect(input.expense).toBe(1700); // 600 + 600 + 500
  });

  it('조립한 입력이 169%로 이어진다', () => {
    const r = assessLiquidityGap(liquidityGapInputFrom(statement, statement.defaultBaseMonth));
    expect(r.kind).toBe('gap');
    if (r.kind !== 'gap') return;
    expect(toPercent(r.gapRatio)).toBeCloseTo(169, 10);
  });

  it('남은 달이 모자라면 조립 단계에서 막힌다', () => {
    expect(() => liquidityGapInputFrom(statement, statement.months[4])).toThrow(/모자/);
  });
});
