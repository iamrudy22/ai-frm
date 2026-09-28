import { describe, it, expect } from 'vitest';
import {
  assessFundingRisk,
  observedMonthOf,
  spreadOf,
  type BondYield,
  type DailyYields,
} from '@/domain/risk/funding-risk/funding-risk';
import { parseCalendarDate } from '@/domain/shared/calendar-date';
import { parseYearMonth } from '@/domain/shared/year-month';

const ym = parseYearMonth;

const bond = (average: number | null, [nice, korea, kis]: (number | null)[] = [null, null, null]): BondYield => ({
  average,
  byAgency: { 나이스피앤아이: nice, 한국자산평가: korea, KIS자산평가: kis },
});

const day = (date: string, publicAaa: number | null, treasury: number | null): DailyYields => ({
  date: parseCalendarDate(date),
  publicAaa: bond(publicAaa),
  treasury: bond(treasury),
});

describe('관측월', () => {
  it('판단월 − 1개월이다 — 8월 판단은 7월, 1월 판단은 전년 12월', () => {
    expect(observedMonthOf(ym('2026/08'))).toBe('2026/07');
    expect(observedMonthOf(ym('2026/01'))).toBe('2025/12');
  });
});

describe('금리 차이', () => {
  it('공사채 AAA − 국고채 (%p)', () => {
    expect(spreadOf(3.674, 3.393)).toBe(0.281);
  });

  // 부동소수로 빼면 3.243 − 3.003 = 0.23999999999999977이라 0.24 경계를 넘지 못한다.
  it('1/1000 정수로 빼서 경계값이 정확하다', () => {
    expect(3.243 - 3.003).toBeLessThan(0.24);
    expect(spreadOf(3.243, 3.003)).toBe(0.24);
    expect(spreadOf(3.912, 3.392)).toBe(0.52);
    expect(spreadOf(4.182, 3.392)).toBe(0.79);
  });

  it('공사채가 더 싸면 음수다', () => {
    expect(spreadOf(3.1, 3.15)).toBe(-0.05);
  });
});

describe('조달위험 인식 지수 판정', () => {
  // 화면 캡처와 같은 값: 2026/07/31 공사채 AAA 3사 평균 3.674, 국고채 3.393.
  it('관측월 마지막 평가일의 3사 평균으로 판정한다 — 8월 판단 = 7/31', () => {
    const result = assessFundingRisk(ym('2026/08'), [
      day('2026/07/31', 3.674, 3.393),
      day('2026/07/30', 3.695, 3.4),
      day('2026/07/01', 3.5, 3.3),
    ]);
    expect(result).toMatchObject({
      kind: 'ok',
      judgedMonth: '2026/08',
      observedMonth: '2026/07',
      evaluationDate: '2026/07/31',
      monthEnd: '2026/07/31',
      spread: 0.281,
      grade: '주의',
    });
  });

  it('평가사별 값도 함께 실어 보낸다', () => {
    const result = assessFundingRisk(ym('2026/08'), [
      {
        date: parseCalendarDate('2026/07/31'),
        publicAaa: bond(3.674, [3.68, 3.665, 3.679]),
        treasury: bond(3.393, [3.395, 3.39, 3.395]),
      },
    ]);
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.publicAaa.byAgency).toEqual({ 나이스피앤아이: 3.68, 한국자산평가: 3.665, KIS자산평가: 3.679 });
    expect(result.treasury.average).toBe(3.393);
  });

  it('말일이 평가일이 아니면 그 전 평가일이다 — 5/31 일요일 → 5/29', () => {
    const result = assessFundingRisk(ym('2026/06'), [day('2026/05/28', 3.426, 3.181), day('2026/05/29', 3.424, 3.176)]);
    expect(result).toMatchObject({ kind: 'ok', evaluationDate: '2026/05/29', monthEnd: '2026/05/31', spread: 0.248 });
  });

  it('날짜 순서에 기대지 않는다', () => {
    const days = [day('2026/07/01', 3.5, 3.3), day('2026/07/31', 3.674, 3.393), day('2026/07/15', 3.6, 3.35)];
    expect(assessFundingRisk(ym('2026/08'), days)).toMatchObject({ evaluationDate: '2026/07/31' });
  });

  it('관측월 밖의 날은 보지 않는다', () => {
    const result = assessFundingRisk(ym('2026/08'), [day('2026/08/03', 9, 1), day('2026/07/31', 3.674, 3.393)]);
    expect(result).toMatchObject({ evaluationDate: '2026/07/31', grade: '주의' });
  });

  it('관측월에 평가일이 없으면 산출불가다', () => {
    expect(assessFundingRisk(ym('2026/08'), [])).toEqual({
      kind: 'unavailable',
      judgedMonth: '2026/08',
      observedMonth: '2026/07',
      reason: '2026/07에 평가일이 없습니다.',
    });
  });

  // 3사 평균이 서비스되기 전(2023/01/09 전)은 행은 오고 값이 빈칸이다.
  it('마지막 평가일의 3사 평균이 비면 산출불가다 — 그 전 평가일로 내려가지 않는다', () => {
    const result = assessFundingRisk(ym('2023/01'), [day('2022/12/29', 4.1, 3.7), day('2022/12/30', null, null)]);
    expect(result).toMatchObject({
      kind: 'unavailable',
      reason: '2022/12/30 평가일의 공사채 AAA·국고채 3사 평균이 비어 있습니다.',
    });
  });

  it('한쪽만 비어도 산출불가이고 어느 쪽인지 알린다', () => {
    expect(assessFundingRisk(ym('2026/08'), [day('2026/07/31', 3.674, null)])).toMatchObject({
      kind: 'unavailable',
      reason: '2026/07/31 평가일의 국고채 3사 평균이 비어 있습니다.',
    });
  });
});
