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

const actual = (month: string, value: number) => ({ month, value });
const plan = (month: string, value: number) => ({ month, value });

describe('회차에서 기재분을 떼어 낸다 (정책 §3-3, 2026-09-28 개정)', () => {
  it('7월 회차 → 그 시트의 실적 전부(1~6월)와 7·8·9·10월 계획', () => {
    const entry = roundEntryOf(createStatement(input(7)));
    expect(entry.round).toBe('2026/07');
    expect(entry.actuals).toEqual([
      actual('2026/01', 101), actual('2026/02', 102), actual('2026/03', 103),
      actual('2026/04', 104), actual('2026/05', 105), actual('2026/06', 106),
    ]);
    expect(entry.plans).toEqual([
      plan('2026/07', 107), plan('2026/08', 108), plan('2026/09', 109), plan('2026/10', 110),
    ]);
    expect(entry.sheetStart).toBe('2026/01');
  });

  // 회차 시트는 계획연도 1월부터라 1월 회차에는 실적 열이 없다(전년 실적은 다른 파일).
  it('1월 회차에는 실적이 없다 — 시트가 시작하는 달을 남겨 전년 달이 없다는 걸 가린다', () => {
    const entry = roundEntryOf(createStatement(input(1)));
    expect(entry.actuals).toEqual([]);
    expect(entry.sheetStart).toBe('2026/01');
    expect(entry.plans.map((p) => p.month)).toEqual(['2026/01', '2026/02', '2026/03', '2026/04']);
  });

  it('11월 회차의 계획은 다음 해 열까지 가고, 계획연도를 넘는 칸에 표시한다', () => {
    const entry = roundEntryOf(createStatement(input(11)));
    expect(entry.plans).toEqual([
      plan('2026/11', 111),
      plan('2026/12', 112),
      { month: '2027/01', value: 113, beyondPlanYear: true },
      { month: '2027/02', value: 114, beyondPlanYear: true },
    ]);
  });

  it('시트 끝을 넘는 계획 칸은 값 대신 사유다 — 0으로 채우지 않는다', () => {
    const short = LABELS.slice(0, 13); // 26.1월까지만
    const entry = roundEntryOf(
      createStatement(
        input(12, {
          monthLabels: short,
          amounts: { ...input(12).amounts, 분양회수: BY_MONTH.slice(0, 13), 기초시재: filled(1).slice(0, 13), 수입계: filled(1).slice(0, 13), 수입: filled(1).slice(0, 13), 기타수입: filled(1).slice(0, 13), 지출: filled(1).slice(0, 13) },
        }),
      ),
    );
    expect(entry.plans[2]).toEqual({ month: '2027/02', missing: expect.stringContaining('없습니다') });
  });

  it('분양회수를 읽지 못한 회차는 거부한다', () => {
    const s = createStatement(input(8, { amounts: { ...input(8).amounts, 분양회수: unreadable('행 없음') } }));
    expect(() => roundEntryOf(s)).toThrow(/분양회수/);
  });
});

describe('서버가 받은 본문을 기재분으로 만든다', () => {
  const valid = {
    round: '2026/03',
    sheetStart: '2026/01',
    actuals: [actual('2026/01', 1), actual('2026/02', 2)],
    plans: [plan('2026/03', 3), plan('2026/04', 4), plan('2026/05', 5), { month: '2026/06', missing: '없음' }],
  };

  it('올바른 본문은 그대로 기재분이 된다', () => {
    expect(roundEntry(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it.each([
    ['실적이 시트 첫 달부터 회차 직전 달까지가 아니다', { ...valid, actuals: [actual('2026/02', 2)] }],
    ['실적이 회차 달을 넘는다', { ...valid, actuals: [...valid.actuals, actual('2026/03', 3)] }],
    ['계획이 네 칸이 아니다', { ...valid, plans: valid.plans.slice(0, 3) }],
    ['계획 달이 회차부터 이어지지 않는다', { ...valid, plans: [plan('2026/04', 1), ...valid.plans.slice(1)] }],
    ['금액이 수가 아니다', { ...valid, actuals: [actual('2026/01', '1' as unknown as number), actual('2026/02', 2)] }],
    ['달 형식이 틀렸다', { ...valid, round: '202603' }],
    ['객체가 아니다', 'hello'],
  ])('%s', (_, body) => {
    expect(() => roundEntry(body)).toThrow();
  });
});
