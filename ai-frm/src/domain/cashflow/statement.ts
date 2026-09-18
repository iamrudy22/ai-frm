/**
 * 자금수지표 회차 — 이 도메인의 애그리거트.
 *
 * "회차"는 매달 새로 작성되는 자금수지표 한 장이다. 한 장 안에 과거 월의
 * 실적과 이후 월의 계획이 함께 들어 있어서 "계획 파일 / 실적 파일"로 부르면
 * 어긋난다. 기준일과 월 계열, 항목 금액을 하나로 묶고 그에 딸린 규칙을
 * 여기서 지킨다.
 *
 * 월을 라벨이 아니라 **인덱스**로 다루는 것이 핵심이다. 실물 시트의 헤더는
 * 계획연도를 '8월'로, 다음 해를 '26.1월'로 적어 형식이 도중에 바뀐다.
 * 라벨로 창을 자르면 12월 다음이 '1월'인지 '26.1월'인지 가릴 수 없고,
 * 실제로 '1월'을 찾으면 8개월 과거를 집는다. 시트가 시간순으로 놓여 있으므로
 * 인덱스로 다루면 이 문제가 사라진다.
 */

import { amount, minus, type Amount } from '@/domain/shared/amount';

export type ItemName = '기초시재' | '수입계' | '수입' | '분양회수' | '지출';

const ITEM_NAMES: readonly ItemName[] = ['기초시재', '수입계', '수입', '분양회수', '지출'];

/** 시트 안에서 한 달이 차지하는 자리. `index`가 정체성이고 `label`은 표시용이다. */
export type Month = {
  readonly index: number;
  readonly label: string;
};

export type StatementInput = {
  /** 시트가 밝히는 기준일. 판독 계층이 A2에서 뽑아 준다. */
  readonly asOf: Date;
  /** 시간순 월 라벨. 소계·집계 열은 판독 계층이 이미 걸러 냈다. */
  readonly monthLabels: readonly string[];
  /** 기준월의 기본값. 사용자가 화면에서 다른 달로 바꿀 수 있다. */
  readonly baseMonthIndex: number;
  /** 항목별 월 계열. 각 배열 길이는 monthLabels와 같아야 한다. */
  readonly amounts: Readonly<Record<ItemName, readonly Amount[]>>;
};

export type Statement = {
  readonly asOf: Date;
  readonly months: readonly Month[];
  readonly defaultBaseMonth: Month;
  amountOf(item: ItemName, month: Month): Amount;
};

export function createStatement(input: StatementInput): Statement {
  const { asOf, monthLabels, baseMonthIndex, amounts } = input;

  if (monthLabels.length === 0) {
    throw new Error('월 목록이 비어 있습니다.');
  }

  for (const item of ITEM_NAMES) {
    const series = amounts[item];
    if (series.length !== monthLabels.length) {
      throw new Error(
        `"${item}" 계열의 길이(${series.length})가 월 수(${monthLabels.length})와 다릅니다.`,
      );
    }
  }

  if (!Number.isInteger(baseMonthIndex) || baseMonthIndex < 0 || baseMonthIndex >= monthLabels.length) {
    throw new Error(`기준월 인덱스가 범위를 벗어났습니다: ${baseMonthIndex}`);
  }

  const months: readonly Month[] = monthLabels.map((label, index) => ({ index, label }));

  return {
    asOf,
    months,
    defaultBaseMonth: months[baseMonthIndex],
    amountOf(item, month) {
      const series = amounts[item];
      const value = series[month.index];
      if (value === undefined) {
        throw new Error(`이 회차에 없는 월입니다: ${month.label}`);
      }
      return value;
    },
  };
}

/**
 * 기준월부터 연속한 `count`개월을 잘라 낸다.
 *
 * 남은 달이 모자라면 짧은 창으로 조용히 판정하지 않고 거부한다.
 * 2개월치로 3개월 순지출을 계산하면 유동성이 실제보다 좋아 보인다.
 */
export function windowFrom(statement: Statement, base: Month, count: number): readonly Month[] {
  const start = base.index;
  const end = start + count;

  if (end > statement.months.length) {
    throw new Error(
      `${base.label}부터 ${count}개월을 잡기에 남은 달이 모자랍니다: ${statement.months.length - start}개월뿐입니다.`,
    );
  }

  return statement.months.slice(start, end);
}

export type ConsecutiveCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * 두 회차가 이어지는지 본다.
 *
 * 화면에서 이전 회차와 최신 회차를 각각 올리는데, 자리가 뒤바뀌면 회수율이
 * 뒤집히고 유동성을 오래된 회차로 판정하게 된다. 그래도 **던지지 않고 값으로
 * 알린다** — 자동으로 고치지 말고 사용자에게 확인을 받아야 하기 때문이다.
 *
 * 월 인덱스는 회차마다 기준이 달라 서로 비교할 수 없으므로 기준일로 따진다.
 */
export function checkConsecutive(prev: Statement, next: Statement): ConsecutiveCheck {
  const months = monthDistance(prev.asOf, next.asOf);

  if (months === 1) return { ok: true };

  if (months <= 0) {
    return {
      ok: false,
      reason: `회차 순서가 뒤바뀐 것 같습니다. 이전 회차가 최신 회차보다 나중입니다(${format(prev.asOf)} → ${format(next.asOf)}).`,
    };
  }

  return {
    ok: false,
    reason: `두 회차가 연속하지 않습니다. ${months}개월 차이입니다(${format(prev.asOf)} → ${format(next.asOf)}).`,
  };
}

function monthDistance(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function format(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 시재 롤포워드 진단 — `기초시재 + 수입계 − 지출 = 다음 달 기초시재`.
 *
 * 실물 회차에서 전 구간 성립하는 것을 확인했다. 어긋난다면 대개 판독 계층이
 * 행을 잘못 잡았다는 뜻이므로, 판정을 막지는 않고 신호만 돌려준다.
 */
export function checkRollForward(statement: Statement, tolerance = 0.01): readonly string[] {
  const issues: string[] = [];

  for (let i = 0; i < statement.months.length - 1; i++) {
    const month = statement.months[i];
    const next = statement.months[i + 1];

    const expected = minus(
      amount(statement.amountOf('기초시재', month) + statement.amountOf('수입계', month)),
      statement.amountOf('지출', month),
    );
    const actual = statement.amountOf('기초시재', next);

    if (Math.abs(expected - actual) > tolerance) {
      issues.push(
        `${next.label} 기초시재가 맞지 않습니다: ${month.label}에서 이어지면 ${expected}여야 하는데 ${actual}입니다.`,
      );
    }
  }

  return issues;
}
