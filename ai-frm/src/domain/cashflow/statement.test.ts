import { describe, it, expect } from 'vitest';
import {
  createStatement,
  windowFrom,
  checkConsecutive,
  unreadable,
  type StatementInput,
} from '@/domain/cashflow/statement';
import { amount } from '@/domain/shared/amount';

// 실물 시트를 본뜬 월 목록. 소계 열(상반기계·하반기계)은 판독 계층이 이미 걸러 낸다.
// 12월 다음이 26.1월인데, 롤포워드로 확인한 바 이 둘은 연속한 달이다.
const LABELS = [
  '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월',
  '9월', '10월', '11월', '12월', '26.1월', '26.2월', '26.3월',
];

const filled = (n: number) => LABELS.map(() => amount(n));

function input(over: Partial<StatementInput> = {}): StatementInput {
  return {
    asOf: new Date(2026, 7, 10), // 2026-08-10
    monthLabels: LABELS,
    baseMonthIndex: 7, // 8월
    amounts: {
      기초시재: filled(1690),
      수입계: filled(900),
      수입: filled(700),
      분양회수: filled(500),
      지출: filled(1700),
    },
    ...over,
  };
}

describe('회차 생성', () => {
  it('기준월은 기본값일 뿐이며 사용자가 바꿀 수 있다', () => {
    const s = createStatement(input());
    expect(s.defaultBaseMonth.label).toBe('8월');
    expect(s.months).toHaveLength(15);
  });

  it('항목 계열 길이가 월 수와 다르면 거부한다', () => {
    expect(() =>
      createStatement(
        input({
          amounts: {
            기초시재: filled(1),
            수입계: filled(1),
            수입: [amount(1)],
            분양회수: filled(1),
            지출: filled(1),
          },
        }),
      ),
    ).toThrow(/길이/);
  });

  it('기준월 인덱스가 범위를 벗어나면 거부한다', () => {
    expect(() => createStatement(input({ baseMonthIndex: 99 }))).toThrow(/기준월/);
  });

  it('월 목록이 비어 있으면 거부한다', () => {
    expect(() => createStatement(input({ monthLabels: [], baseMonthIndex: 0 }))).toThrow();
  });
});

// 한 항목이 깨졌다고 회차 전체를 버리면, 그 항목을 쓰지 않는 지표까지 멈춘다.
// 깨진 항목은 사유와 함께 품고, 그 항목을 찾는 쪽에서만 실패하게 한다.
describe('읽지 못한 항목', () => {
  const partial = () =>
    createStatement(
      input({
        amounts: {
          기초시재: filled(1690),
          수입계: filled(900),
          수입: filled(700),
          분양회수: unreadable('"분양회수"의 10월 칸이 비어 있습니다.'),
          지출: filled(1700),
        },
      }),
    );

  it('회차는 만들어지고, 읽은 항목은 그대로 조회된다', () => {
    const s = partial();
    expect(s.amountOf('수입', s.months[7])).toBe(700);
  });

  it('읽지 못한 항목을 조회하면 사유와 함께 거부한다 — 0으로 대신하지 않는다', () => {
    const s = partial();
    expect(() => s.amountOf('분양회수', s.months[7])).toThrow(/분양회수.*10월 칸이 비어/);
  });

  it('읽지 못한 항목과 사유를 알려 준다', () => {
    expect(partial().unreadableItems()).toEqual([
      { item: '분양회수', reason: '"분양회수"의 10월 칸이 비어 있습니다.' },
    ]);
  });

  it('읽지 못한 항목에는 길이 검사를 하지 않는다', () => {
    expect(() => partial()).not.toThrow();
  });

  it('모든 항목을 읽지 못하면 회차를 거부한다 — 표가 통째로 다른 시트일 가능성이 크다', () => {
    const none = unreadable('행이 없습니다.');
    expect(() =>
      createStatement(
        input({
          amounts: { 기초시재: none, 수입계: none, 수입: none, 분양회수: none, 지출: none },
        }),
      ),
    ).toThrow(/어떤 항목도/);
  });
});

describe('항목 조회', () => {
  it('월별 금액을 읽는다', () => {
    const s = createStatement(input());
    expect(s.amountOf('수입', s.months[7])).toBe(700);
  });

  it('이 회차에 없는 월은 거부한다', () => {
    const s = createStatement(input());
    expect(() => s.amountOf('수입', { index: 99, label: '없는달' })).toThrow(/없는달/);
  });
});

describe('3개월 창', () => {
  it('기준월부터 3개월을 자른다', () => {
    const s = createStatement(input());
    expect(windowFrom(s, s.months[7], 3).map((m) => m.label)).toEqual(['8월', '9월', '10월']);
  });

  it('연도 경계를 넘어간다 — 라벨 형식이 바뀌어도 인덱스로 자르기 때문이다', () => {
    const s = createStatement(input());
    const december = s.months[11];
    expect(windowFrom(s, december, 3).map((m) => m.label)).toEqual(['12월', '26.1월', '26.2월']);
  });

  it('남은 월이 모자라면 거부한다 — 짧은 창으로 조용히 판정하지 않는다', () => {
    const s = createStatement(input());
    expect(() => windowFrom(s, s.months[14], 3)).toThrow(/모자/);
  });
});

describe('회차 연속성', () => {
  const july = createStatement(input({ asOf: new Date(2026, 6, 8) }));
  const august = createStatement(input({ asOf: new Date(2026, 7, 10) }));
  const october = createStatement(input({ asOf: new Date(2026, 9, 12) }));

  it('한 달 차이면 연속이다', () => {
    expect(checkConsecutive(july, august)).toEqual({ ok: true });
  });

  it('순서가 뒤바뀌면 그렇다고 알려 준다', () => {
    const r = checkConsecutive(august, july);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/순서/);
  });

  it('간격이 벌어지면 알려 준다', () => {
    const r = checkConsecutive(july, october);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/연속/);
  });

  it('해를 넘어가도 한 달 차이는 연속이다', () => {
    const dec = createStatement(input({ asOf: new Date(2026, 11, 9) }));
    const jan = createStatement(input({ asOf: new Date(2027, 0, 9) }));
    expect(checkConsecutive(dec, jan)).toEqual({ ok: true });
  });
});

describe('시재 롤포워드 진단', () => {
  it('기초시재 + 수입계 − 지출 = 다음 달 기초시재를 확인한다', async () => {
    const { checkRollForward } = await import('@/domain/cashflow/statement');
    const consistent = createStatement(
      input({
        amounts: {
          기초시재: [amount(100), amount(150), amount(200)],
          수입계: [amount(100), amount(100), amount(100)],
          지출: [amount(50), amount(50), amount(50)],
          수입: [amount(80), amount(80), amount(80)],
          분양회수: [amount(60), amount(60), amount(60)],
        },
        monthLabels: ['1월', '2월', '3월'],
        baseMonthIndex: 0,
      }),
    );
    expect(checkRollForward(consistent)).toEqual([]);
  });

  it('어긋나면 어느 달인지 짚어 준다 — 판독 계층이 행을 잘못 잡은 신호다', async () => {
    const { checkRollForward } = await import('@/domain/cashflow/statement');
    const broken = createStatement(
      input({
        amounts: {
          기초시재: [amount(100), amount(999), amount(200)],
          수입계: [amount(100), amount(100), amount(100)],
          지출: [amount(50), amount(50), amount(50)],
          수입: [amount(80), amount(80), amount(80)],
          분양회수: [amount(60), amount(60), amount(60)],
        },
        monthLabels: ['1월', '2월', '3월'],
        baseMonthIndex: 0,
      }),
    );
    // 값 하나가 틀어지면 그 달로 들어오는 연결과 나가는 연결이 함께 깨진다.
    const issues = checkRollForward(broken);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatch(/2월/);
    expect(issues[1]).toMatch(/3월/);
  });

  it('필요한 항목을 읽지 못했으면 확인할 수 없다고 알린다 — 조용히 통과시키지 않는다', async () => {
    const { checkRollForward } = await import('@/domain/cashflow/statement');
    const s = createStatement(
      input({
        amounts: {
          기초시재: filled(1690),
          수입계: unreadable('"수입계(자금조달포함)" 항목을 A열에서 찾을 수 없습니다.'),
          수입: filled(700),
          분양회수: filled(500),
          지출: filled(1700),
        },
      }),
    );
    const issues = checkRollForward(s);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/확인할 수 없습니다.*수입계/);
  });

  it('롤포워드에 쓰지 않는 항목이 깨진 것은 상관없다', async () => {
    const { checkRollForward } = await import('@/domain/cashflow/statement');
    const s = createStatement(
      input({
        amounts: {
          기초시재: [amount(100), amount(150)],
          수입계: [amount(100), amount(100)],
          수입: [amount(80), amount(80)],
          분양회수: unreadable('빈 칸'),
          지출: [amount(50), amount(50)],
        },
        monthLabels: ['1월', '2월'],
        baseMonthIndex: 0,
      }),
    );
    expect(checkRollForward(s)).toEqual([]);
  });
});
