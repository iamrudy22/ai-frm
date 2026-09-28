import { describe, it, expect } from 'vitest';
import { assessFundingRiskReport } from '@/application/funding-risk';
import type { BondYieldSource, YieldFetch } from '@/application/ports';
import type { DailyYields } from '@/domain/risk/funding-risk/funding-risk';
import { parseCalendarDate } from '@/domain/shared/calendar-date';
import { parseYearMonth, type YearMonth } from '@/domain/shared/year-month';

const NOW = () => new Date(2026, 8, 28); // 2026-09-28
const FETCHED = new Date(2026, 8, 28, 9, 30);

const day = (date: string, publicAaa: number, treasury: number): DailyYields => {
  const none = { 나이스피앤아이: null, 한국자산평가: null, KIS자산평가: null };
  return {
    date: parseCalendarDate(date),
    publicAaa: { average: publicAaa, byAgency: none },
    treasury: { average: treasury, byAgency: none },
  };
};

/** 달마다 정해 둔 응답을 돌려주고, 어느 달을 불렀는지 적어 둔다. */
function fakeSource(byMonth: Record<string, YieldFetch | Error>, calls: YearMonth[] = []): BondYieldSource {
  return {
    dailyYields: async (month) => {
      calls.push(month);
      const answer = byMonth[month] ?? { days: [], fetchedAt: FETCHED };
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

const run = (source: BondYieldSource, judgedMonth?: string) =>
  assessFundingRiskReport(source, { judgedMonth: judgedMonth === undefined ? undefined : parseYearMonth(judgedMonth) }, NOW);

describe('조달위험 인식 지수 유스케이스', () => {
  it('판단월 − 1의 금리를 불러 판정한다 — 8월 회차면 7월', async () => {
    const calls: YearMonth[] = [];
    const out = await run(fakeSource({ '2026/07': { days: [day('2026/07/31', 3.674, 3.393)], fetchedAt: FETCHED } }, calls), '2026/08');
    expect(calls).toEqual(['2026/07']);
    expect(out).toEqual({
      ok: true,
      value: expect.objectContaining({
        source: '회차',
        fetchedAt: FETCHED,
        result: expect.objectContaining({ kind: 'ok', judgedMonth: '2026/08', spread: 0.281, grade: '주의' }),
      }),
    });
  });

  it('판단월이 없으면 오늘이 속한 달 — 9월 28일이면 8월 금리', async () => {
    const calls: YearMonth[] = [];
    const out = await run(fakeSource({}, calls));
    expect(calls).toEqual(['2026/08']);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.source).toBe('오늘');
    expect(out.value.result.judgedMonth).toBe('2026/09');
  });

  it('관측월이 아직 끝나지 않았으면 조회하지 않고 산출불가다', async () => {
    const calls: YearMonth[] = [];
    const out = await run(fakeSource({}, calls), '2026/10');
    expect(calls).toEqual([]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.result).toEqual({
      kind: 'unavailable',
      judgedMonth: '2026/10',
      observedMonth: '2026/09',
      reason: '아직 2026/09 말이 지나지 않았습니다.',
    });
    expect(out.value.fetchedAt).toBeNull();
  });

  it('조회 실패는 산출불가 사유다 — 던지지 않는다', async () => {
    const out = await run(fakeSource({ '2026/07': { error: 'HTTP 503' } }), '2026/08');
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.result).toMatchObject({ kind: 'unavailable', reason: '채권정보센터 조회 실패: HTTP 503' });
  });

  it('출처가 던져도 산출불가 사유로 바꾼다', async () => {
    const out = await run(fakeSource({ '2026/07': new Error('fetch failed') }), '2026/08');
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.result).toMatchObject({ kind: 'unavailable', reason: '채권정보센터 조회 실패: fetch failed' });
  });

  it('평가일이 없으면 산출불가다', async () => {
    const out = await run(fakeSource({}), '2026/08');
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.result).toMatchObject({ kind: 'unavailable', reason: '2026/07에 평가일이 없습니다.' });
  });
});
