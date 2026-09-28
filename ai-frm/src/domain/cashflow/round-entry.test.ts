import { describe, it, expect } from 'vitest';
import { createStatement, unreadable, type StatementInput } from '@/domain/cashflow/statement';
import { roundEntry, roundEntryOf } from '@/domain/cashflow/round-entry';
import { amount } from '@/domain/shared/amount';

// 실물 2026년 시트처럼 12월 다음 열을 '26.1월'로 적는다(달력으로는 2027/01).
const LABELS = [
  '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월',
  '9월', '10월', '11월', '12월', '26.1월', '26.2월', '26.3월',
];

// 분양회수 금액을 달마다 다르게 둔다: 1월 101, 2월 102, …
const BY_MONTH = LABELS.map((_, i) => amount(101 + i));
const filled = (n: number) => LABELS.map(() => amount(n));

function input(month: number, over: Partial<StatementInput> = {}): StatementInput {
  return {
    asOf: new Date(2026, month - 1, 10),
    monthLabels: LABELS,
    baseMonthIndex: month - 1,
    planYearEndIndex: 11,
    amounts: {
      기초시재: filled(1690),
      수입계: filled(900),
      수입: filled(700),
      분양회수: BY_MONTH,
      기타수입: filled(100),
      지출: filled(1700),
    },
    ...over,
  };
}

describe('회차에서 기재분을 떼어 낸다', () => {
  it('8월 회차 → 7월 실적 1개와 8·9·10월 계획', () => {
    const entry = roundEntryOf(createStatement(input(8)));
    expect(entry).toEqual({
      round: '2026/08',
      actual: { month: '2026/07', value: 107 },
      plan: { month: '2026/08', values: [108, 109, 110], beyondPlanYear: false },
    });
  });

  it('11월 회차의 계획은 다음 해 열에 걸친다 — 표시를 붙인다', () => {
    const entry = roundEntryOf(createStatement(input(11)));
    expect(entry.plan).toEqual({ month: '2026/11', values: [111, 112, 113], beyondPlanYear: true });
  });

  it('10월 회차의 계획은 12월에서 끝나므로 표시가 없다', () => {
    expect(roundEntryOf(createStatement(input(10))).plan.beyondPlanYear).toBe(false);
  });

  // 회차 시트는 계획연도 1월부터라 1월 회차에는 전년 12월 열이 없다(구현 계획 R7).
  it('1월 회차에는 직전 월 열이 없다 — 실적을 비우고 사유를 남긴다', () => {
    const entry = roundEntryOf(createStatement(input(1)));
    expect(entry.actual).toEqual({ month: '2025/12', missing: expect.stringContaining('12월') });
    expect(entry.plan.values).toEqual([101, 102, 103]);
  });

  it('분양회수를 읽지 못한 회차는 거부한다', () => {
    const s = createStatement(
      input(8, {
        amounts: { ...input(8).amounts, 분양회수: unreadable('행 없음') },
      }),
    );
    expect(() => roundEntryOf(s)).toThrow(/분양회수/);
  });
});

describe('서버가 받은 본문을 기재분으로 만든다', () => {
  const valid = {
    round: '2026/08',
    actual: { month: '2026/07', value: 107 },
    plan: { month: '2026/08', values: [108, 109, 110], beyondPlanYear: false },
  };

  it('올바른 본문은 그대로 기재분이 된다', () => {
    expect(roundEntry(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it('실적이 비어 있는 1월 회차 본문도 받는다', () => {
    const jan = {
      round: '2027/01',
      actual: { month: '2026/12', missing: '없음' },
      plan: { month: '2027/01', values: [1, 2, 3], beyondPlanYear: false },
    };
    expect(roundEntry(jan)).toEqual(jan);
  });

  it.each([
    ['실적 달이 회차 직전 달이 아니다', { ...valid, actual: { month: '2026/06', value: 1 } }],
    ['계획 달이 회차 달이 아니다', { ...valid, plan: { ...valid.plan, month: '2026/09' } }],
    ['계획이 세 칸이 아니다', { ...valid, plan: { ...valid.plan, values: [1, 2] } }],
    ['금액이 수가 아니다', { ...valid, actual: { month: '2026/07', value: '107' } }],
    ['금액이 유한하지 않다', { ...valid, plan: { ...valid.plan, values: [1, 2, null] } }],
    ['달 형식이 틀렸다', { ...valid, round: '202608' }],
    ['객체가 아니다', 'hello'],
  ])('%s', (_, body) => {
    expect(() => roundEntry(body)).toThrow();
  });
});
