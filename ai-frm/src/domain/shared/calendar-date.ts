/**
 * 달력 날짜 — `'2026/07/31'`.
 *
 * 채권 시가평가 금리처럼 날짜마다 오는 값을 달력 월(year-month.ts)에 잇는다.
 * 모양은 달력 월에 일을 붙인 것이다. 두 자리로 채우므로 문자열 사전순이 곧 시간순이다.
 */

import { yearMonth, type YearMonth } from '@/domain/shared/year-month';

declare const brand: unique symbol;

export type CalendarDate = string & { readonly [brand]: 'CalendarDate' };

const PATTERN = /^(\d{4})\/(\d{2})\/(\d{2})$/;

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function calendarDate(year: number, month: number, day: number): CalendarDate {
  const ym = yearMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > daysIn(year, month)) {
    throw new Error(`${ym}에 ${day}일은 없습니다.`);
  }
  return `${ym}/${String(day).padStart(2, '0')}` as CalendarDate;
}

export function parseCalendarDate(text: string): CalendarDate {
  const match = PATTERN.exec(text);
  if (match === null) {
    throw new Error(`달력 날짜는 YYYY/MM/DD 형식이어야 합니다: ${text}`);
  }
  return calendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function monthOfDate(date: CalendarDate): YearMonth {
  return date.slice(0, 7) as YearMonth;
}

export function firstDayOf(month: YearMonth): CalendarDate {
  const [year, m] = month.split('/').map(Number);
  return calendarDate(year, m, 1);
}

/** 그 달의 말일. 평가일인지는 모른다 — 달력의 마지막 날이다. */
export function lastDayOf(month: YearMonth): CalendarDate {
  const [year, m] = month.split('/').map(Number);
  return calendarDate(year, m, daysIn(year, m));
}
