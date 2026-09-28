import { describe, it, expect } from 'vitest';
import {
  assessAdequateCash,
  adequateCashAt,
  adequateCashInputFrom,
  adequateCashSeries,
} from '@/domain/risk/adequate-cash/adequate-cash';
import { createStatement, unreadable, type ItemSeries, type ItemName } from '@/domain/cashflow/statement';
import { amount } from '@/domain/shared/amount';

// 금액은 모두 합성값이다. 실물 자금수지표의 수치를 쓰지 않는다.
const given = (v: {
  opening: number;
  sales: number;
  other: number;
  income: number;
  expense: number;
}) =>
  assessAdequateCash({
    openingCash: amount(v.opening),
    salesRecovery: amount(v.sales),
    otherIncome: amount(v.other),
    income: amount(v.income),
    expense: amount(v.expense),
  });

// PRD §4-3 검증 케이스. 값은 3개월 합계다.
describe('적정 시재 판정 — PRD §4-3', () => {
  const base = { sales: 1000, other: 500, income: 2000, expense: 5000 };

  it('1. 0.2×1,000 + 0.1×500 + 0.1×5,000 + 0.4×3,000 = 1,950 — 기초시재 2,400이면 안정적', () => {
    const r = given({ ...base, opening: 2400 });
    expect(r.adequateCash).toBeCloseTo(1950, 9);
    expect(r.isAdequate).toBe(true);
    expect(r.surplus).toBeCloseTo(450, 9);
  });

  it('2. 기초시재 1,800이면 적정시재 부족', () => {
    const r = given({ ...base, opening: 1800 });
    expect(r.isAdequate).toBe(false);
    expect(r.surplus).toBeCloseTo(-150, 9);
  });

  it('3. 기초시재와 적정시재가 같으면 안정적 — 경계는 안정적에 포함한다(PRD §9-2)', () => {
    expect(given({ ...base, opening: 1950 }).isAdequate).toBe(true);
  });

  it('4. 순유입이면 수지차가 음수라 적정시재를 낮춘다 — 350, 기초시재 100이면 부족', () => {
    const r = given({ sales: 1000, other: 500, income: 6000, expense: 5000, opening: 100 });
    expect(r.adequateCash).toBeCloseTo(350, 9);
    expect(r.isAdequate).toBe(false);
  });

  it('5. 적정시재가 음수여도 그대로 쓴다 — −1,480, 기초시재 0이면 안정적(PRD §9-3)', () => {
    const r = given({ sales: 100, other: 0, income: 5000, expense: 1000, opening: 0 });
    expect(r.adequateCash).toBeCloseTo(-1480, 9);
    expect(r.isAdequate).toBe(true);
  });
});

describe('적정 시재 산출 내역', () => {
  const r = given({ opening: 2400, sales: 1000, other: 500, income: 2000, expense: 5000 });

  it('네 항목의 3개월 합계·가중치·가중값을 내놓는다', () => {
    expect(r.components.map((c) => [c.key, c.total, c.weight])).toEqual([
      ['분양회수', 1000, 0.2],
      ['기타수입', 500, 0.1],
      ['지출', 5000, 0.1],
      ['수지차', 3000, 0.4],
    ]);
  });

  it('수지차는 지출 − 수입이다 — 시트의 수지차 행(수입 − 지출)과 부호가 반대', () => {
    expect(r.components.find((c) => c.key === '수지차')?.total).toBe(3000);
  });

  it('가중값의 합이 적정시재다', () => {
    const sum = r.components.reduce((a, c) => a + c.weighted, 0);
    expect(sum).toBeCloseTo(r.adequateCash, 9);
  });

  it('결과에 등급이 없다 — T/F만 있다', () => {
    expect(r).not.toHaveProperty('grade');
    expect(typeof r.isAdequate).toBe('boolean');
  });
});

// ── 회차에서 조립 ─────────────────────────────────────────────────────────

const LABELS = [
  '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월',
  '9월', '10월', '11월', '12월', '26.1월', '26.2월', '26.3월',
];
const byIndex = (f: (i: number) => number) => LABELS.map((_, i) => amount(f(i)));

function statement(over: Partial<Record<ItemName, ItemSeries>> = {}) {
  return createStatement({
    asOf: new Date(2026, 7, 10),
    monthLabels: LABELS,
    baseMonthIndex: 7, // 8월 — 회차 기준월
    planYearEndIndex: 11, // 12월
    amounts: {
      기초시재: byIndex((i) => 10000 + i), // 달마다 다르게 두어 어느 달 것을 읽는지 드러나게 한다
      수입계: byIndex(() => 9999), // 조달 포함 — 읽으면 안 된다
      수입: byIndex(() => 700),
      분양회수: byIndex(() => 300),
      기타수입: byIndex(() => 100),
      지출: byIndex(() => 1700),
      ...over,
    },
  });
}

describe('회차에서 입력 조립', () => {
  const s = statement();
  const aug = s.months[7];

  it('기초시재는 기준월 것만, 나머지는 3개월 합계다', () => {
    expect(adequateCashInputFrom(s, aug)).toEqual({
      openingCash: 10007,
      salesRecovery: 900,
      otherIncome: 300,
      income: 2100,
      expense: 5100,
    });
  });

  it('수입은 수입계(조달 포함)가 아니라 수입 행이다 — 자금조달은 산식에서 뺀다', () => {
    expect(adequateCashInputFrom(s, aug).income).toBe(2100);
  });

  it('남은 달이 모자라면 조립 단계에서 막힌다', () => {
    expect(() => adequateCashInputFrom(s, s.months[13])).toThrow(/모자랍니다/);
  });

  it('기타수입을 읽지 못하면 사유와 함께 막힌다 — 0으로 세지 않는다', () => {
    const broken = statement({ 기타수입: unreadable('"기타수입"의 10월 칸이 비어 있습니다.') });
    expect(() => adequateCashInputFrom(broken, aug)).toThrow(/기타수입/);
  });
});

describe('한 달치 — 계획·다음 해 표시', () => {
  const s = statement();
  const at = (i: number) => adequateCashAt(s, s.months[i]);

  it('회차 기준월(8월)은 계획이 아니다 — 기초시재가 7월 실적에서 이어진 값이다', () => {
    expect(at(7)).toMatchObject({ isPlan: false, beyondPlanYear: false });
  });

  it('회차 기준월 뒤의 달은 계획이다 — 기초시재가 계획 조달까지 포함한 이월 잔고다', () => {
    expect(at(8).isPlan).toBe(true);
  });

  it('창이 12월에서 끝나면 계획연도 안이다', () => {
    expect(at(9)).toMatchObject({ windowEnd: { label: '12월' }, beyondPlanYear: false });
  });

  it('창이 다음 해 열에 걸치면 "다음 해 계획 미확정" 대상이다', () => {
    expect(at(10)).toMatchObject({ windowEnd: { label: '26.1월' }, beyondPlanYear: true });
  });

  it('회차 기준월보다 앞의 달은 계획이 아니다', () => {
    expect(at(5).isPlan).toBe(false);
  });
});

describe('매월 롤링', () => {
  const s = statement();

  it('기준월부터 창이 시트 안에 드는 마지막 달까지 — 8월 회차면 8월~26.1월 여섯 달', () => {
    const { rows, cutoff } = adequateCashSeries(s, s.months[7]);
    expect(rows.map((r) => r.month.label)).toEqual(['8월', '9월', '10월', '11월', '12월', '26.1월']);
    expect(cutoff?.label).toBe('26.2월');
  });

  it('창이 모자라는 달은 빼고 던지지 않는다 — 짧은 창으로 계산하지 않는다', () => {
    const { rows, cutoff } = adequateCashSeries(s, s.months[13]);
    expect(rows).toEqual([]);
    expect(cutoff?.label).toBe('26.2월');
  });

  it('각 행은 한 달치 산출과 같다', () => {
    const { rows } = adequateCashSeries(s, s.months[7]);
    expect(rows[2]).toEqual(adequateCashAt(s, s.months[9]));
  });
});
