import { describe, it, expect } from 'vitest';
import { basisText, canRetry, evaluationNote, rateText, yieldRows } from '@/app/aifrm/funding-risk-view';

const agencies = (nice: number | null, korea: number | null, kis: number | null) => ({
  나이스피앤아이: nice,
  한국자산평가: korea,
  KIS자산평가: kis,
});

// 화면 캡처(2026/07/31)와 같은 값.
const ok = {
  kind: 'ok',
  judgedMonth: '2026/08',
  observedMonth: '2026/07',
  evaluationDate: '2026/07/31',
  monthEnd: '2026/07/31',
  publicAaa: { average: 3.674, byAgency: agencies(3.68, 3.665, 3.679) },
  treasury: { average: 3.393, byAgency: agencies(3.395, 3.39, null) },
  spread: 0.281,
  grade: '주의',
} as never;

describe('조달위험 인식 지수 표시', () => {
  it('금리는 셋째 자리까지, 빈칸은 —', () => {
    expect(rateText(3.39)).toBe('3.390');
    expect(rateText(null)).toBe('—');
  });

  it('두 채권의 평가사별 금리와 3사 평균, 두 평균의 차이', () => {
    expect(yieldRows(ok)).toEqual([
      { 채권: '공사채 AAA 1년', 나이스피앤아이: '3.680', 한국자산평가: '3.665', KIS자산평가: '3.679', '3사 평균': '3.674' },
      { 채권: '국고채 1년', 나이스피앤아이: '3.395', 한국자산평가: '3.390', KIS자산평가: '—', '3사 평균': '3.393' },
      { 채권: '금리 차이', 나이스피앤아이: '', 한국자산평가: '', KIS자산평가: '', '3사 평균': '0.281%p' },
    ]);
  });

  it('판단월이 어디서 왔는지와 어느 달 금리인지', () => {
    expect(basisText({ source: '회차', result: ok })).toBe('판단월 2026/08(최신 회차) · 2026/07 말 금리');
    expect(basisText({ source: '오늘', result: ok })).toBe('판단월 2026/08(회차 없음, 오늘 기준) · 2026/07 말 금리');
  });

  it('말일이 평가일이 아니었을 때만 밝힌다', () => {
    expect(evaluationNote(ok)).toBeNull();
    const may = { ...(ok as object), evaluationDate: '2026/05/29', monthEnd: '2026/05/31' } as never;
    expect(evaluationNote(may)).toBe('2026/05/31은 평가일이 아니어서 그 전 평가일 2026/05/29의 금리를 씁니다.');
  });

  it('조회하지 못했을 때만 다시 불러오기를 권한다', () => {
    const unavailable = (fetchedAt: string | null) =>
      ({ ok: true, value: { source: '회차', result: { kind: 'unavailable' }, fetchedAt } }) as never;
    expect(canRetry({ ok: false, reason: 'x' })).toBe(true);
    expect(canRetry(unavailable(null))).toBe(true);
    expect(canRetry(unavailable('2026-09-28T00:00:00.000Z'))).toBe(false);
    expect(canRetry({ ok: true, value: { source: '회차', result: ok, fetchedAt: '2026-09-28T00:00:00.000Z' } })).toBe(false);
  });
});
