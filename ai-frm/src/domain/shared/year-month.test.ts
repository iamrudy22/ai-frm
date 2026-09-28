import { describe, it, expect } from 'vitest';
import {
  addMonths,
  compareYearMonth,
  parseYearMonth,
  yearMonth,
  yearMonthOfDate,
} from '@/domain/shared/year-month';

describe('달력 월', () => {
  it('정책 문서와 엑셀의 시점 키와 같은 모양이다', () => {
    expect(yearMonth(2026, 7)).toBe('2026/07');
    expect(parseYearMonth('2026/07')).toBe('2026/07');
  });

  it('달이 범위를 벗어나거나 형식이 다르면 달력 월이 아니다', () => {
    expect(() => yearMonth(2026, 0)).toThrow();
    expect(() => yearMonth(2026, 13)).toThrow();
    expect(() => yearMonth(2026.5, 1)).toThrow();
    expect(() => parseYearMonth('2026/13')).toThrow();
    expect(() => parseYearMonth('202607')).toThrow();
    expect(() => parseYearMonth('2026/7')).toThrow();
  });

  it('해를 넘겨 더하고 뺀다', () => {
    expect(addMonths(yearMonth(2026, 12), 1)).toBe('2027/01');
    expect(addMonths(yearMonth(2026, 1), -1)).toBe('2025/12');
    expect(addMonths(yearMonth(2026, 1), -12)).toBe('2025/01');
    expect(addMonths(yearMonth(2026, 8), 0)).toBe('2026/08');
    expect(addMonths(yearMonth(2026, 8), 17)).toBe('2028/01');
  });

  it('정수가 아닌 개월 수는 더하지 않는다', () => {
    expect(() => addMonths(yearMonth(2026, 8), 1.5)).toThrow();
  });

  it('시간순으로 비교한다 — 문자열 사전순과 달력 순서가 같다', () => {
    expect(compareYearMonth(yearMonth(2025, 12), yearMonth(2026, 1))).toBeLessThan(0);
    expect(compareYearMonth(yearMonth(2026, 10), yearMonth(2026, 9))).toBeGreaterThan(0);
    expect(compareYearMonth(yearMonth(2026, 7), yearMonth(2026, 7))).toBe(0);
  });

  it('날짜가 속한 달', () => {
    expect(yearMonthOfDate(new Date(2026, 7, 10))).toBe('2026/08');
  });
});
