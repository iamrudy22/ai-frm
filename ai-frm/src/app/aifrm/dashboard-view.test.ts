import { describe, it, expect } from 'vitest';
import { calendarOptions, calendarOfLabel, monthAt, spanText } from '@/app/aifrm/dashboard-view';
import { createStatement, type ItemName, type ItemSeries } from '@/domain/cashflow/statement';
import { amount } from '@/domain/shared/amount';
import { parseYearMonth } from '@/domain/shared/year-month';

// 실물 헤더처럼 12월 다음 달을 '26.1월'로 적는다. 라벨과 달리 2027년이다(기준일 2026-08).
const LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월', '26.1월', '26.2월', '26.3월'];
const flat = LABELS.map(() => amount(100));
const august = createStatement({
  asOf: new Date(2026, 7, 10),
  monthLabels: LABELS,
  baseMonthIndex: 7,
  planYearEndIndex: 11,
  amounts: Object.fromEntries(
    (['기초시재', '수입계', '수입', '분양회수', '기타수입', '지출'] as ItemName[]).map((k) => [k, flat]),
  ) as unknown as Record<ItemName, ItemSeries>,
});

describe('기준월 표기를 YYYY/MM으로 맞춘다', () => {
  it('선택지는 회차의 모든 달을 달력 월로 — 26.1월은 2027/01이다', () => {
    const options = calendarOptions(august);
    expect(options[0]).toBe('2026/01');
    expect(options[7]).toBe('2026/08');
    expect(options.slice(-3)).toEqual(['2027/01', '2027/02', '2027/03']);
  });

  it('고른 달력 월로 회차의 열을 찾는다', () => {
    expect(monthAt(august, parseYearMonth('2027/01'))?.label).toBe('26.1월');
    expect(monthAt(august, parseYearMonth('2026/08'))?.label).toBe('8월');
  });

  it('회차에 없는 달이면 찾지 않는다', () => {
    expect(monthAt(august, parseYearMonth('2025/12'))).toBeNull();
  });

  it('라벨을 달력 월로 바꾼다 — 대금 회수 위험의 판정 대상월', () => {
    expect(calendarOfLabel(august, '7월')).toBe('2026/07');
    expect(calendarOfLabel(august, '26.2월')).toBe('2027/02');
    expect(calendarOfLabel(august, '없는 달')).toBeNull();
  });

  it('구간은 첫 달부터 개월 수만큼 — 연도를 넘어도 달력 월로', () => {
    expect(spanText(parseYearMonth('2026/08'), 3)).toBe('2026/08~2026/10');
    expect(spanText(parseYearMonth('2026/11'), 3)).toBe('2026/11~2027/01');
  });
});
