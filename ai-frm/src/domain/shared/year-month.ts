/**
 * 달력 월 — `'2026/07'`.
 *
 * 회차 안의 월은 인덱스로 다룬다(cashflow/statement.ts). 그런데 ECOS 계열과
 * 분양회수 계획·실적 이력은 회차 바깥에 있어서 달력으로 이어야 한다. 그 다리가
 * 이 타입이다. 모양은 정책 문서와 엑셀의 시점 키(`YYYY/MM`)와 같다.
 *
 * 월을 두 자리로 채우므로 문자열 사전순이 곧 시간순이다.
 */

declare const brand: unique symbol;

export type YearMonth = string & { readonly [brand]: 'YearMonth' };

const PATTERN = /^(\d{4})\/(\d{2})$/;

export function yearMonth(year: number, month: number): YearMonth {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error(`연도는 네 자리 정수여야 합니다: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`달은 1~12여야 합니다: ${month}`);
  }
  return `${year}/${String(month).padStart(2, '0')}` as YearMonth;
}

export function parseYearMonth(text: string): YearMonth {
  const match = PATTERN.exec(text);
  if (match === null) {
    throw new Error(`달력 월은 YYYY/MM 형식이어야 합니다: ${text}`);
  }
  return yearMonth(Number(match[1]), Number(match[2]));
}

export function yearMonthOfDate(date: Date): YearMonth {
  return yearMonth(date.getFullYear(), date.getMonth() + 1);
}

export function addMonths(ym: YearMonth, months: number): YearMonth {
  if (!Number.isInteger(months)) {
    throw new Error(`개월 수는 정수여야 합니다: ${months}`);
  }
  const [year, month] = ym.split('/').map(Number);
  const serial = year * 12 + (month - 1) + months;
  return yearMonth(Math.floor(serial / 12), (serial % 12) + 1);
}

export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
