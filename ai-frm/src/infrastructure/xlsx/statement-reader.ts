/**
 * 자금수지표 엑셀을 회차로 옮기는 부패 방지 계층.
 *
 * 엑셀 양식을 아는 파일은 여기 하나다. 도메인은 xlsx를 모른다.
 * 시트 구조가 바뀌면 이 파일만 고치면 되고, 파서를 통째로 갈아 끼울 때도
 * 도메인은 건드리지 않는다.
 *
 * 위치를 고정하지 않는 것이 이 계층의 일이다. 셀 좌표는 매달 움직인다.
 *   - 시트명에 연도가 들어가므로 완전 일치로 찾으면 해가 바뀔 때 깨진다
 *   - 항목은 A열 라벨로 찾는다. 행 번호는 믿지 않는다
 *   - 월은 헤더에서 찾는다. 소계 열이 중간에 끼어 있어 열 오프셋도 믿지 않는다
 */

import * as XLSX from 'xlsx';
import { amount, type Amount } from '@/domain/shared/amount';
import {
  createStatement,
  unreadable,
  type ItemName,
  type ItemSeries,
  type Statement,
} from '@/domain/cashflow/statement';

/** 연도가 매년 바뀐다. `(기본)` 시트가 따로 있으므로 `(본운영반영)`으로 가른다. */
const SHEET_PATTERN = /자금수지표\(본운영반영\)/;

/**
 * 월 열만 고른다.
 *
 * 소계·집계 열을 이름으로 열거해 빼는 방식은 열이 늘어나면 뚫린다.
 * 실물만 해도 `상반기계`·`하반기계`·`26년 총계©`·`25년 실적`·`23년`·
 * `본운영계획대비`가 섞여 있다. 월을 알아보는 쪽이 안전하다.
 * `26.1월`처럼 다음 해를 가리키는 형식도 받는다.
 */
const MONTH_LABEL = /^\d+(\.\d+)?월$/;

const AS_OF_DATE = /(\d{4})-(\d{2})-(\d{2})/;

/**
 * 도메인 용어 → 시트 라벨. `수입계`의 실제 라벨은 `수입계(자금조달포함)`다.
 *
 * `분양회수`는 완전 일치라야 한다. 같은 시트에 `공공분양자금`·`분양`·
 * `- 미분양자산펀드`가 따로 있어서 부분 일치로 찾으면 엉뚱한 행을 집는다.
 */
const SHEET_LABEL: Record<ItemName, string> = {
  기초시재: '기초시재',
  수입계: '수입계(자금조달포함)',
  수입: '수입',
  분양회수: '분양회수',
  지출: '지출',
};

const ITEMS = Object.keys(SHEET_LABEL) as readonly ItemName[];

/** 헤더·기준일을 찾아 훑는 범위. 표 머리는 시트 맨 위에 있다. */
const PREAMBLE_ROWS = 10;

export type ReadResult =
  | { readonly ok: true; readonly statement: Statement }
  | { readonly ok: false; readonly error: string };

type Grid = readonly (readonly unknown[])[];

export function readStatement(data: ArrayBuffer): ReadResult {
  let grid: Grid | null;
  try {
    grid = toGrid(data);
  } catch {
    return fail('엑셀 파일을 열 수 없습니다.');
  }
  if (grid === null) {
    return fail(`"자금수지표(본운영반영)" 시트를 찾을 수 없습니다.`);
  }

  const headerRowIndex = grid.findIndex(
    (row) => row.filter((cell) => MONTH_LABEL.test(text(cell))).length >= 3,
  );
  if (headerRowIndex < 0 || headerRowIndex >= PREAMBLE_ROWS) {
    return fail('월 표기가 있는 헤더 행을 찾을 수 없습니다.');
  }

  const monthColumns: { index: number; label: string }[] = [];
  grid[headerRowIndex].forEach((cell, column) => {
    const label = text(cell);
    if (MONTH_LABEL.test(label)) monthColumns.push({ index: column, label });
  });

  const asOf = findAsOf(grid, headerRowIndex);
  if (asOf === null) {
    return fail('기준일을 찾을 수 없습니다. 표 위쪽의 YYYY-MM-DD 표기를 확인하세요.');
  }

  const baseMonthIndex = monthColumns.findIndex(
    (m) => m.label === `${asOf.getMonth() + 1}월`,
  );
  if (baseMonthIndex < 0) {
    return fail(
      `기준일(${asOf.getFullYear()}-${asOf.getMonth() + 1})의 달에 해당하는 열을 찾을 수 없습니다.`,
    );
  }

  // 항목 하나가 깨졌다고 회차 전체를 거부하면 그 항목을 쓰지 않는 지표까지 멈춘다.
  // 그 항목만 사유와 함께 '읽지 못함'으로 두고, 찾는 쪽에서 실패하게 한다.
  // 시트·헤더·기준일처럼 회차의 뼈대가 없을 때만 위에서 전체를 거부한다.
  const amounts: Partial<Record<ItemName, ItemSeries>> = {};
  for (const item of ITEMS) {
    const series = readSeries(grid, headerRowIndex, monthColumns, item);
    amounts[item] = typeof series === 'string' ? unreadable(series) : series;
  }

  try {
    return {
      ok: true,
      statement: createStatement({
        asOf,
        monthLabels: monthColumns.map((m) => m.label),
        baseMonthIndex,
        amounts: amounts as Record<ItemName, ItemSeries>,
      }),
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : '회차를 만들 수 없습니다.');
  }
}

function toGrid(data: ArrayBuffer): Grid | null {
  // 실물 파일은 7MB에 시트가 27개다. 통째로 파싱하면 6초가 넘는데, 시트 이름만
  // 먼저 훑고 필요한 하나만 파싱하면 1초대로 떨어진다. 브라우저에서는 사용자가
  // 그대로 기다리는 시간이다.
  const names = XLSX.read(data, { type: 'array', bookSheets: true }).SheetNames;
  const name = names.find((n) => SHEET_PATTERN.test(n));
  if (name === undefined) return null;

  const sheet = XLSX.read(data, { type: 'array', sheets: [name] }).Sheets[name];
  if (sheet === undefined) return null;

  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  }) as Grid;
}

function findAsOf(grid: Grid, headerRowIndex: number): Date | null {
  for (let r = 0; r < Math.min(headerRowIndex, PREAMBLE_ROWS); r++) {
    for (const cell of grid[r]) {
      const match = AS_OF_DATE.exec(text(cell));
      if (match) {
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      }
    }
  }
  return null;
}

/** 실패하면 사람이 읽을 메시지를 문자열로 돌려준다. */
function readSeries(
  grid: Grid,
  headerRowIndex: number,
  monthColumns: readonly { index: number; label: string }[],
  item: ItemName,
): readonly Amount[] | string {
  const label = SHEET_LABEL[item];

  // 완전 일치라야 한다. `수입`을 부분 일치로 찾으면 `수입계(자금조달포함)`이 먼저 걸린다.
  const rowIndex = grid.findIndex(
    (row, r) => r > headerRowIndex && text(row[0]) === label,
  );
  if (rowIndex < 0) {
    return `"${label}" 항목을 A열에서 찾을 수 없습니다.`;
  }

  const row = grid[rowIndex];
  const series: Amount[] = [];

  for (const month of monthColumns) {
    const cell = row[month.index];
    if (cell === null || cell === undefined || cell === '') {
      return `"${label}"의 ${month.label} 칸이 비어 있습니다. 0으로 세면 순지출이 실제보다 작아 보입니다.`;
    }
    if (typeof cell !== 'number') {
      return `"${label}"의 ${month.label} 칸이 숫자가 아닙니다: ${text(cell)}`;
    }
    try {
      series.push(amount(cell));
    } catch {
      return `"${label}"의 ${month.label} 칸을 금액으로 읽을 수 없습니다: ${text(cell)}`;
    }
  }

  return series;
}

function text(cell: unknown): string {
  return cell === null || cell === undefined ? '' : String(cell).trim();
}

function fail(error: string): ReadResult {
  return { ok: false, error };
}
