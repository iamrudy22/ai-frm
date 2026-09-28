import { describe, it, expect } from 'vitest';
import { ratio, type Ratio } from '@/domain/shared/amount';
import { yearMonth, type YearMonth } from '@/domain/shared/year-month';
import {
  assessConstructionPerception,
  baseMonthOfRound,
  baseMonthOfToday,
  scoreBy,
  type EcosIndicatorKey,
  type Missing,
  type PerceptionInput,
  type RawSeries,
} from '@/domain/risk/construction-perception/construction-perception';
import { REPORT_LAG_MONTHS, SCORING_RULES, type IndicatorKey } from '@/domain/risk/construction-perception/policy';

const rule = (key: IndicatorKey) => {
  const found = SCORING_RULES.find((r) => r.key === key);
  if (found === undefined) throw new Error(key);
  return found;
};

describe('점수 — 엑셀 IF문과 같다', () => {
  it.each([
    // [지표, 변화율, 기대 점수]
    ['총수주액', -0.6, 1],
    ['총수주액', -0.9, 1],
    ['총수주액', -0.3, 0.5],
    ['총수주액', 0, 0],
    ['총수주액', 0.4, 0],
    ['주택매매가격지수', -0.015, 1],
    ['주택매매가격지수', -0.0075, 0.5],
    ['미분양주택현황', 0.3, 1],
    ['미분양주택현황', 0.2, 0.5],
    ['미분양주택현황', 0.1, 0],
    ['미분양주택현황', -0.5, 0],
    ['설비투자지수', -0.1, 1],
    ['설비투자지수', -0.075, 0.5],
    ['설비투자지수', -0.05, 0],
    ['설비투자지수', -0.04, 0],
    ['대출금리', 60, 1],
    ['대출금리', 40, 0.5],
    ['대출금리', 20, 0],
    ['대출금리', 12, 0],
    ['분양회수예측오차', -0.4, 1],
    ['분양회수예측오차', -0.2, 0.5],
    ['분양회수예측오차', 0.1, 0],
    ['주가', -0.15, 1],
    ['주가', -0.1, 0.5],
    ['주가', -0.05, 0],
    ['선행지수순환변동치', -0.006, 1],
    ['선행지수순환변동치', -0.004, 0.5],
  ] as const)('%s %s → %s', (key, change, expected) => {
    expect(scoreBy(rule(key), change)).toBeCloseTo(expected, 12);
  });

  it('환율은 오르든 내리든 같은 점수다', () => {
    expect(scoreBy(rule('환율'), 0.05)).toBeCloseTo(0.5, 12);
    expect(scoreBy(rule('환율'), -0.05)).toBeCloseTo(0.5, 12);
    expect(scoreBy(rule('환율'), -0.08)).toBe(1);
    expect(scoreBy(rule('환율'), 0.02)).toBe(0);
  });

  // 엑셀은 4번·10번만 0점 조건이 `>`(초과)다. 그러나 경계에서 선형식도 0을 내므로
  // 결과는 같다. 이 차이가 드러나지 않는다는 사실을 고정한다.
  it('인허가 0%, 선행지수 −0.2%는 0점이다 — 엑셀의 `>` 경계는 결과를 바꾸지 않는다', () => {
    expect(scoreBy(rule('주택건설인허가실적'), 0)).toBe(0);
    expect(scoreBy(rule('선행지수순환변동치'), -0.002)).toBe(0);
  });

  it('점수는 −0이 아니라 0이다', () => {
    expect(Object.is(scoreBy(rule('주택건설인허가실적'), 0), 0)).toBe(true);
  });
});

// ── 합성 입력 ─────────────────────────────────────────────────────────────

const T = yearMonth(2026, 7);
const PREV = yearMonth(2026, 6);
const LAST_YEAR = yearMonth(2025, 7);

/** 모든 지표가 0점이 되는 평온한 달: 전월·전년동월과 값이 같다. */
function calmSeries(): Record<EcosIndicatorKey, Map<YearMonth, number>> {
  const flat = () =>
    new Map<YearMonth, number>([
      [LAST_YEAR, 100],
      [PREV, 100],
      [T, 100],
    ]);
  return {
    총수주액: flat(),
    주택매매가격지수: flat(),
    미분양주택현황: flat(),
    주택건설인허가실적: flat(),
    설비투자지수: flat(),
    대출금리: flat(),
    환율: flat(),
    주가: flat(),
    선행지수순환변동치: flat(),
  };
}

function input(
  series: Record<EcosIndicatorKey, RawSeries> = calmSeries(),
  forecastError: (t: YearMonth) => Ratio | Missing = () => ratio(0.1),
): PerceptionInput {
  return { series, forecastError };
}

describe('종합위기인식지수', () => {
  it('10종이 모두 0점이면 지수 0, 정상', () => {
    const r = assessConstructionPerception(input(), T);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.index).toBe(0);
    expect(r.grade).toBe('정상');
    expect(r.lines).toHaveLength(10);
  });

  it('인허가만 전년동월비 −30%면 31 × 0.5 = 15.5, 정상', () => {
    const s = calmSeries();
    s.주택건설인허가실적.set(T, 70);
    const r = assessConstructionPerception(input(s), T);
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.index).toBeCloseTo(15.5, 12);
    expect(r.grade).toBe('정상');
  });

  it('인허가 −60%와 주택가격 −1.5%면 31 + 23 = 54, 경고', () => {
    const s = calmSeries();
    s.주택건설인허가실적.set(T, 40);
    s.주택매매가격지수.set(T, 98.5);
    const r = assessConstructionPerception(input(s), T);
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.index).toBeCloseTo(54, 12);
    expect(r.grade).toBe('경고');
  });

  it('지표별 원값·변화율·점수·기여도를 남긴다 — 단계가 왜 나왔는지 답할 수 있다', () => {
    const s = calmSeries();
    s.대출금리.set(PREV, 4.19);
    s.대출금리.set(T, 4.69); // +50bp → (50 − 20) / 40 = 0.75점
    const r = assessConstructionPerception(input(s), T);
    if (r.kind !== 'ok') throw new Error(r.kind);
    const line = r.lines.find((l) => l.key === '대출금리');
    expect(line?.current).toBe(4.69);
    expect(line?.reference).toBe(4.19);
    expect(line?.change).toBeCloseTo(50, 9);
    expect(line?.score).toBeCloseTo(0.75, 9);
    expect(line?.contribution).toBeCloseTo(1.8935899081681278 * 0.75, 9);
  });

  it('분양회수 예측오차는 이력에서 온 오차율을 그대로 쓴다', () => {
    const r = assessConstructionPerception(input(calmSeries(), () => ratio(-0.2)), T);
    if (r.kind !== 'ok') throw new Error(r.kind);
    const line = r.lines.find((l) => l.key === '분양회수예측오차');
    expect(line?.change).toBe(-0.2);
    expect(line?.score).toBeCloseTo(0.5, 12);
    expect(line?.current).toBeUndefined();
  });
});

describe('결측은 0이 아니다 (정책 §6-1)', () => {
  // 엑셀 2026/07 행: 주택매매가격지수 한 칸만 채워져 있는데 빈칸이 0으로 계산되어
  // 지수 68.4 "위기"가 나왔다.
  it('2026/07 재현 — 한 지표만 있으면 위기가 아니라 산출불가다', () => {
    const s = calmSeries();
    for (const key of Object.keys(s) as EcosIndicatorKey[]) {
      if (key !== '주택매매가격지수') s[key].delete(T);
    }
    const r = assessConstructionPerception(input(s), T);
    expect(r.kind).toBe('unavailable');
    if (r.kind !== 'unavailable') return;
    expect(r.missing.map((m) => m.key)).toHaveLength(8);
    expect(r.missing.map((m) => m.key)).not.toContain('주택매매가격지수');
  });

  it('전월대비 지표는 전월 값이 없으면 결측이다', () => {
    const s = calmSeries();
    s.환율.delete(PREV);
    const r = assessConstructionPerception(input(s), T);
    if (r.kind !== 'unavailable') throw new Error(r.kind);
    expect(r.missing).toEqual([{ key: '환율', reason: expect.stringContaining('2026/06') }]);
  });

  it('전년동월비 지표는 12개월 전 값이 없으면 결측이다', () => {
    const s = calmSeries();
    s.총수주액.delete(LAST_YEAR);
    const r = assessConstructionPerception(input(s), T);
    if (r.kind !== 'unavailable') throw new Error(r.kind);
    expect(r.missing).toEqual([{ key: '총수주액', reason: expect.stringContaining('2025/07') }]);
  });

  it('비교 값이 0이면 변화율을 낼 수 없으므로 결측이다 — 무한대가 1점으로 들어가지 않는다', () => {
    const s = calmSeries();
    s.미분양주택현황.set(PREV, 0);
    const r = assessConstructionPerception(input(s), T);
    expect(r.kind).toBe('unavailable');
  });

  it('분양회수 예측오차가 없으면 결측이다', () => {
    const r = assessConstructionPerception(
      input(calmSeries(), () => ({ missing: '2026/05 회차 계획이 없습니다' })),
      T,
    );
    if (r.kind !== 'unavailable') throw new Error(r.kind);
    expect(r.missing).toEqual([{ key: '분양회수예측오차', reason: '2026/05 회차 계획이 없습니다' }]);
  });
});

describe('기준월 (정책 §5, 2026-09-28 재개정)', () => {
  // 7월 판단은 4~7월 회차로 한다. 자금수지표 지표들과 같은 달을 본다.
  it('회차를 올렸으면 최신 회차의 달이다 — 7월 회차면 7월', () => {
    expect(baseMonthOfRound(yearMonth(2026, 7))).toBe('2026/07');
  });

  it('회차 없이 보면 오늘 − 2개월이다 — 9월에 보면 7월', () => {
    expect(baseMonthOfToday(yearMonth(2026, 9))).toBe('2026/07');
  });

  it('해를 넘긴다 — 1월에 회차 없이 보면 전년 11월', () => {
    expect(baseMonthOfToday(yearMonth(2027, 1))).toBe('2026/11');
  });

  it('보고 시차는 정책 상수 한 곳에 있다', () => {
    expect(REPORT_LAG_MONTHS).toBe(2);
  });

  // 거슬러 내려가 처음 산출되는 달을 보여 주면 직전 확정월을 조용히 보여 주는
  // 것과 같다(정책 §9-1 Q2에서 쓰지 않기로 함). 고른 달 하나만 산출한다.
  it('고른 기준월에 빈 값이 있으면 이전 달로 내려가지 않고 그 달의 산출불가다', () => {
    const s = calmSeries();
    s.설비투자지수.delete(T);
    const r = assessConstructionPerception(input(s), T);
    expect(r).toMatchObject({ kind: 'unavailable', month: '2026/07' });
  });
});
