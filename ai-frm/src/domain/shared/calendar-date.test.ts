import { describe, it, expect } from 'vitest';
import { calendarDate, firstDayOf, lastDayOf, monthOfDate, parseCalendarDate } from '@/domain/shared/calendar-date';
import { parseYearMonth } from '@/domain/shared/year-month';

describe('달력 날짜', () => {
  it('YYYY/MM/DD로 두 자리를 채운다', () => {
    expect(calendarDate(2026, 7, 3)).toBe('2026/07/03');
    expect(parseCalendarDate('2026/07/31')).toBe('2026/07/31');
  });

  it('없는 날짜는 거부한다 — 윤년도 가린다', () => {
    expect(() => calendarDate(2026, 2, 29)).toThrow('2026/02에 29일은 없습니다');
    expect(calendarDate(2028, 2, 29)).toBe('2028/02/29');
    expect(() => calendarDate(2026, 4, 31)).toThrow();
    expect(() => calendarDate(2026, 13, 1)).toThrow();
    expect(() => parseCalendarDate('20260731')).toThrow('YYYY/MM/DD');
  });

  it('그 달의 첫날과 말일', () => {
    expect(firstDayOf(parseYearMonth('2026/05'))).toBe('2026/05/01');
    expect(lastDayOf(parseYearMonth('2026/05'))).toBe('2026/05/31');
    expect(lastDayOf(parseYearMonth('2026/06'))).toBe('2026/06/30');
    expect(lastDayOf(parseYearMonth('2026/02'))).toBe('2026/02/28');
    expect(lastDayOf(parseYearMonth('2028/02'))).toBe('2028/02/29');
  });

  it('날짜가 속한 달', () => {
    expect(monthOfDate(parseCalendarDate('2026/07/31'))).toBe('2026/07');
  });

  it('문자열 순서가 시간 순서다', () => {
    expect(parseCalendarDate('2026/05/29') < parseCalendarDate('2026/05/31')).toBe(true);
    expect(parseCalendarDate('2025/12/31') < parseCalendarDate('2026/01/02')).toBe(true);
  });
});
