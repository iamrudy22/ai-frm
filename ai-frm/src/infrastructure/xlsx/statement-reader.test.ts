import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { readStatement } from '@/infrastructure/xlsx/statement-reader';
import { liquidityGapInputFrom, assessLiquidityGap } from '@/domain/risk/liquidity-gap/liquidity-gap';
import { toPercent } from '@/domain/shared/amount';

// 실물 시트를 본뜬 헤더. 월 사이에 소계가 끼어 있고, 뒤쪽에 집계·과거연도 열이 붙는다.
// 26.1월~26.3월은 라벨과 달리 12월 다음에 이어지는 달이다(롤포워드로 확인).
const HEADER = [
  '', '연간계획(A)\r\n잠정기준', '연간계획(B)본운영기준',
  '1월', '2월', '3월', '4월', '5월', '6월', '상반기계',
  '7월', '8월', '9월', '10월', '11월', '12월',
  '26.1월', '26.2월', '26.3월', '하반기계',
  '26년\r\n총계©', '25년\r\n실적', '23년', '본운영계획대비',
];

const MONTH_COLUMNS = [3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18];

/** 월 열에만 값을 채운 데이터 행을 만든다. 나머지 칸은 집계라 판정에 쓰지 않는다. */
function row(label: string, monthValues: readonly (number | string | null)[]): unknown[] {
  const cells: unknown[] = new Array(HEADER.length).fill(0);
  cells[0] = label;
  MONTH_COLUMNS.forEach((col, i) => {
    cells[col] = monthValues[i];
  });
  return cells;
}

const same = (n: number) => MONTH_COLUMNS.map(() => n);

type SheetOptions = {
  sheetName?: string;
  asOf?: string;
  rows?: unknown[][];
  header?: readonly unknown[];
};

function workbook(options: SheetOptions = {}): ArrayBuffer {
  const {
    sheetName = '12_26년자금수지표(본운영반영)',
    asOf = '2026-08-10(단위: 억원)',
    header = HEADER,
    rows = [
      row('기초시재', same(1690)),
      row('수입계(자금조달포함)', same(900)),
      row('수입', same(300)),
      // 부분 일치로 찾으면 걸려드는 이웃들. 실물 시트에 실제로 함께 있다.
      row('공공분양자금', same(77)),
      row('분양회수', same(200)),
      row('분양', same(88)),
      // 지출을 라벨로만 찾는지 보려고 실물(41행)과 다른 자리에 둔다.
      row('지출', same(600)),
    ],
  } = options;

  const aoa: unknown[][] = [[], [asOf], [...header], [], ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

function readOk(options: SheetOptions = {}) {
  const result = readStatement(workbook(options));
  if (!result.ok) throw new Error(`판독 실패: ${result.error}`);
  return result.statement;
}

function readErr(options: SheetOptions = {}): string {
  const result = readStatement(workbook(options));
  if (result.ok) throw new Error('오류가 날 줄 알았는데 성공했습니다.');
  return result.error;
}

describe('시트 찾기', () => {
  it('연도가 바뀌어도 찾는다 — 매년 시트명이 바뀐다', () => {
    expect(readOk({ sheetName: '12_27년자금수지표(본운영반영)' }).months).toHaveLength(15);
  });

  it('본운영반영이 아닌 시트는 쓰지 않는다', () => {
    expect(readErr({ sheetName: '12_26년자금수지표(기본)' })).toMatch(/본운영반영/);
  });
});

describe('월 열 판독', () => {
  it('소계·집계·과거연도 열을 걸러 낸다', () => {
    const labels = readOk().months.map((m) => m.label);
    expect(labels).toEqual([
      '1월', '2월', '3월', '4월', '5월', '6월',
      '7월', '8월', '9월', '10월', '11월', '12월',
      '26.1월', '26.2월', '26.3월',
    ]);
    expect(labels).not.toContain('상반기계');
    expect(labels).not.toContain('하반기계');
    expect(labels).not.toContain('23년');
    expect(labels).not.toContain('본운영계획대비');
  });

  it('기준일의 달을 기준월 기본값으로 삼는다', () => {
    expect(readOk().defaultBaseMonth.label).toBe('8월');
    expect(readOk({ asOf: '2026-12-01(단위: 억원)' }).defaultBaseMonth.label).toBe('12월');
  });
});

describe('항목 찾기', () => {
  it('수입을 수입계로 착각하지 않는다', () => {
    const s = readOk();
    expect(s.amountOf('수입', s.months[0])).toBe(300);
    expect(s.amountOf('수입계', s.months[0])).toBe(900);
  });

  it('분양회수를 공공분양자금이나 분양과 헷갈리지 않는다', () => {
    const s = readOk();
    expect(s.amountOf('분양회수', s.months[0])).toBe(200);
  });

  it('지출이 몇 번째 행이든 라벨로 찾는다', () => {
    const s = readOk();
    expect(s.amountOf('지출', s.months[0])).toBe(600);
  });

  it('항목이 없으면 어느 항목인지 알려 준다', () => {
    const rows = [
      row('기초시재', same(1)),
      row('수입계(자금조달포함)', same(1)),
      row('수입', same(1)),
      row('분양회수', same(1)),
    ];
    expect(readErr({ rows })).toMatch(/지출/);
  });
});

describe('판독 실패', () => {
  it('기준일을 못 읽으면 거부한다 — 회차 순서를 확인할 수 없다', () => {
    expect(readErr({ asOf: '(단위: 억원)' })).toMatch(/기준일/);
  });

  it('기준일의 달에 해당하는 열이 없으면 거부한다', () => {
    const header = [...HEADER];
    header[11] = '8월분'; // 월 표기가 아니게 되어 월 목록에서 빠진다
    expect(readErr({ header })).toMatch(/8/);
  });

  it('빈 칸이 있으면 거부한다 — 0으로 세면 순지출이 작아 보인다', () => {
    const values: (number | null)[] = same(300);
    values[3] = null;
    const rows = [
      row('기초시재', same(1690)),
      row('수입계(자금조달포함)', same(900)),
      row('수입', values),
      row('분양회수', same(200)),
      row('지출', same(600)),
    ];
    expect(readErr({ rows })).toMatch(/수입/);
  });

  it('숫자가 아니면 거부한다', () => {
    const values: (number | string)[] = same(300);
    values[2] = '미정';
    const rows = [
      row('기초시재', same(1690)),
      row('수입계(자금조달포함)', same(900)),
      row('수입', values),
      row('분양회수', same(200)),
      row('지출', same(600)),
    ];
    expect(readErr({ rows })).toMatch(/수입/);
  });
});

describe('판독에서 판정까지', () => {
  it('회의록의 169%가 재현된다', () => {
    // 8월 기준 3개월: 수입 300*3=900, 지출 600*3=1800, 순지출 900... 이 아니라
    // 기초시재 1690 / 순지출 900 = 187.8%가 되므로 값을 맞춰 준다.
    const income = same(0).map((_, i) => ([11, 12, 13].includes(MONTH_COLUMNS[i]) ? 700 / 3 : 999));
    const expense = same(0).map((_, i) => ([11, 12, 13].includes(MONTH_COLUMNS[i]) ? 1700 / 3 : 999));
    const s = readOk({
      rows: [
        row('기초시재', same(1690)),
        row('수입계(자금조달포함)', same(900)),
        row('수입', income),
        row('분양회수', same(200)),
        row('지출', expense),
      ],
    });
    const gap = assessLiquidityGap(liquidityGapInputFrom(s, s.defaultBaseMonth));
    expect(gap.kind).toBe('gap');
    if (gap.kind !== 'gap') return;
    expect(toPercent(gap.gapRatio)).toBeCloseTo(169, 6);
  });
});
