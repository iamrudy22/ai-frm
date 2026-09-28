/**
 * 대시보드의 월 표기 — 회차 시트의 라벨(`8월`, `26.1월`)을 달력 월(`2026/08`)로 바꾼다.
 *
 * 시트 라벨은 연도가 없고 다음 해를 `26.1월`처럼 적어 읽는 사람이 헷갈린다.
 * 건설경기 인식 지수는 처음부터 `YYYY/MM`이라, 한 화면에 두 표기가 섞였다.
 * 화면에 보이는 달은 모두 여기서 달력 월로 바꾼다. 계산은 그대로 시트의 열(Month)로 한다.
 */

import { calendarOf, type Month, type Statement } from '@/domain/cashflow/statement';
import { addMonths, type YearMonth } from '@/domain/shared/year-month';

/** 회차의 모든 달을 달력 월로. 시트 순서 그대로다. */
export function calendarOptions(statement: Statement): YearMonth[] {
  return statement.months.map((m) => calendarOf(statement, m));
}

/** 달력 월에 해당하는 회차의 열. 회차에 없는 달이면 null. */
export function monthAt(statement: Statement, month: YearMonth): Month | null {
  return statement.months.find((m) => calendarOf(statement, m) === month) ?? null;
}

/** 시트 라벨을 달력 월로. 회차에 없는 라벨이면 null. */
export function calendarOfLabel(statement: Statement, label: string): YearMonth | null {
  const month = statement.months.find((m) => m.label === label);
  return month === undefined ? null : calendarOf(statement, month);
}

/** `2026/08~2026/10`. */
export function spanText(from: YearMonth, months: number): string {
  return `${from}~${addMonths(from, months - 1)}`;
}
