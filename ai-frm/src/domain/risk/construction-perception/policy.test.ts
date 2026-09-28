import { describe, it, expect } from 'vitest';
import { gradeBy } from '@/domain/risk/grade';
import {
  SCORING_RULES,
  STAGE_BANDS,
  commentFor,
  perceptionIndex,
} from '@/domain/risk/construction-perception/policy';

describe('점수화 기준 표', () => {
  it('엑셀 위기단계 시트의 B~K열 순서대로 10종이다', () => {
    expect(SCORING_RULES.map((r) => r.key)).toEqual([
      '총수주액',
      '주택매매가격지수',
      '미분양주택현황',
      '주택건설인허가실적',
      '설비투자지수',
      '대출금리',
      '분양회수예측오차',
      '환율',
      '주가',
      '선행지수순환변동치',
    ]);
  });

  it('가중치는 엑셀 B2:K2 그대로다 — 합이 100이 아니어도 정규화하지 않는다', () => {
    const sum = SCORING_RULES.reduce((a, r) => a + r.weight, 0);
    expect(sum).toBeCloseTo(100.47417291001882, 12);
  });

  it('만점과 영점은 위험 방향에 맞게 놓여 있다', () => {
    for (const rule of SCORING_RULES) {
      if (rule.direction === '하락') expect(rule.full).toBeLessThan(rule.zero);
      else expect(rule.full).toBeGreaterThan(rule.zero);
    }
  });

  it('변환 방식이 엑셀 기초데이터 4행과 같다', () => {
    const transform = Object.fromEntries(SCORING_RULES.map((r) => [r.key, r.transform]));
    expect(transform).toEqual({
      총수주액: '전년동월비',
      주택매매가격지수: '전월대비',
      미분양주택현황: '전월대비',
      주택건설인허가실적: '전년동월비',
      설비투자지수: '전월대비',
      대출금리: '전월차bp',
      분양회수예측오차: '3개월누적오차율',
      환율: '전월대비',
      주가: '전월대비',
      선행지수순환변동치: '전월대비',
    });
  });
});

describe('종합위기단계', () => {
  it.each([
    [0, '정상'],
    [19.999999, '정상'],
    [20, '주의'],
    [39.999, '주의'],
    [40, '경고'],
    [59.999, '경고'],
    [60, '위기'],
    [100, '위기'],
    // 가중치 합이 100.474라 전 지표 만점이면 100을 넘는다. 엑셀은 이때 빈칸이지만
    // 여기서는 위기다(정책 §3-6).
    [100.47417291001882, '위기'],
  ])('지수 %s → %s', (value, expected) => {
    expect(gradeBy(STAGE_BANDS, perceptionIndex(value))).toBe(expected);
  });

  it('유한하지 않은 지수는 만들 수 없다', () => {
    expect(() => perceptionIndex(Number.NaN)).toThrow();
  });

  it('단계마다 코멘트가 있다', () => {
    for (const grade of ['정상', '주의', '경고', '위기'] as const) {
      expect(commentFor(grade).length).toBeGreaterThan(0);
    }
  });
});
