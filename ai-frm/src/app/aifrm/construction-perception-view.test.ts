import { describe, it, expect } from 'vitest';
import type { PerceptionReportDto } from '@/app/api/construction-perception/dto';
import {
  baseMonthNote,
  changeText,
  indicatorRows,
  ledgerNote,
  missingRows,
} from '@/app/aifrm/construction-perception-view';
import type { IndicatorKey } from '@/domain/risk/construction-perception/policy';

const KEYS: IndicatorKey[] = [
  '총수주액', '주택매매가격지수', '미분양주택현황', '주택건설인허가실적', '설비투자지수',
  '대출금리', '분양회수예측오차', '환율', '주가', '선행지수순환변동치',
];

function report(over: Partial<PerceptionReportDto> = {}): PerceptionReportDto {
  return {
    basis: { baseMonth: '2026/07' as never, reportMonth: '2026/09' as never, source: '오늘' },
    selectable: { from: '2026/05' as never, to: '2026/08' as never },
    result: {
      kind: 'ok',
      month: '2026/07',
      index: 15.153263772586111,
      grade: '정상',
      lines: KEYS.map((key) =>
        key === '분양회수예측오차'
          ? { key, change: 0.2411, score: 0, contribution: 0 }
          : key === '대출금리'
            ? { key, current: 4.27, reference: 4.31, change: -4.000000000000004, score: 0, contribution: 0 }
            : key === '주가'
              ? { key, current: 6595.45, reference: 8476.48, change: -0.2219, score: 1, contribution: 4.783203423392172 }
              : { key, current: 14357324, reference: 21762480, change: -0.3405, score: 0.5675, contribution: 6.2785 },
      ),
    } as unknown as PerceptionReportDto['result'],
    diagnostics: {
      indicators: KEYS.map((key) => ({
        key,
        latest: (['주택매매가격지수', '환율', '주가'].includes(key) ? '2026/08' : '2026/07') as never,
        ...(key === '분양회수예측오차' ? {} : { unit: key === '대출금리' ? '연%' : key === '총수주액' ? '백만원' : '지수' }),
      })),
      ledger: { latestActualMonth: '2026/07' as never, gaps: [] },
      fetchedAt: '2026-09-28T00:00:00.000Z',
    },
    ...over,
  };
}

describe('변화율 표기', () => {
  it('비율은 부호를 붙인 퍼센트, 소수 둘째 자리', () => {
    expect(changeText('총수주액', -0.34054)).toBe('−34.05%');
    expect(changeText('환율', 0.0196)).toBe('+1.96%');
    expect(changeText('분양회수예측오차', 0.24107)).toBe('+24.11%');
  });

  it('대출금리만 bp다 — 부동소수 찌꺼기를 걷어 낸다', () => {
    expect(changeText('대출금리', -4.000000000000004)).toBe('−4.0bp');
    expect(changeText('대출금리', 12)).toBe('+12.0bp');
  });

  it('0은 부호 없이', () => {
    expect(changeText('주가', 0)).toBe('0.00%');
  });
});

describe('지표 표', () => {
  it('엑셀과 같은 1~10번 순서이고, 원값에 ECOS 단위를 붙인다', () => {
    const rows = indicatorRows(report());
    expect(rows.map((r) => r.지표)).toEqual([
      '총수주액', '주택매매가격지수', '미분양주택현황', '주택건설인허가실적', '설비투자지수',
      '대출금리', '분양회수 예측오차', '환율', '주가', '선행지수 순환변동치',
    ]);
    expect(rows[0].원값).toBe('14,357,324 백만원');
    expect(rows[5]).toMatchObject({ 원값: '4.27 연%', 변화율: '−4.0bp', 점수: '0.000', 기여도: '0.00' });
  });

  it('분양회수 예측오차는 원값이 없다 — 이력에서 계산한 오차율이다', () => {
    expect(indicatorRows(report())[6]).toMatchObject({ 원값: '—', 변화율: '+24.11%' });
  });

  it('점수는 소수 셋째, 기여도는 둘째 자리', () => {
    expect(indicatorRows(report())[8]).toMatchObject({ 점수: '1.000', 기여도: '4.78' });
  });

  it('산출불가면 표가 없다', () => {
    expect(indicatorRows(report({ result: { kind: 'unavailable', month: '2026/07' as never, missing: [] } }))).toEqual([]);
  });
});

describe('빠진 지표', () => {
  it('지표 이름과 사유를 보인다', () => {
    const rows = missingRows({
      kind: 'unavailable',
      month: '2026/07' as never,
      missing: [{ key: '분양회수예측오차', reason: '분양회수 2026/06 실적이 이력에 없습니다.' }],
    });
    expect(rows).toEqual([{ 지표: '분양회수 예측오차', 사유: '분양회수 2026/06 실적이 이력에 없습니다.' }]);
  });
});

describe('기준월 설명', () => {
  it('먼저 나온 지표가 있으면 무엇이 기준월을 늦추는지 알린다', () => {
    expect(baseMonthNote(report())).toBe(
      '주택매매가격지수·환율·주가는 2026/08까지 나왔지만, 나머지 지표가 2026/07까지라 2026/07 기준입니다.',
    );
  });

  it('모두 같은 달이면 설명하지 않는다', () => {
    const r = report();
    const same = {
      ...r,
      diagnostics: { ...r.diagnostics, indicators: r.diagnostics.indicators.map((i) => ({ ...i, latest: '2026/07' as never })) },
    };
    expect(baseMonthNote(same)).toBeNull();
  });
});

describe('이력 안내', () => {
  it('빈 달이 없으면 마지막 실적 달만 알린다', () => {
    expect(ledgerNote({ latestActualMonth: '2026/07' as never, gaps: [] })).toBe(
      '분양회수 계획·실적 이력: 2026/07 실적까지 쌓였습니다.',
    );
  });

  it('빈 달이 있으면 채우는 법을 알린다', () => {
    expect(ledgerNote({ latestActualMonth: '2026/08' as never, gaps: ['2026/06', '2026/07'] as never })).toBe(
      '분양회수 계획·실적 이력: 2026/08 실적까지 쌓였지만 2026/06, 2026/07이(가) 비어 있습니다. 그 달과 다음 달 회차를 올리면 채워집니다.',
    );
  });

  it('이력이 비어 있으면 회차를 올리라고 알린다', () => {
    expect(ledgerNote({ latestActualMonth: null, gaps: [] })).toBe(
      '분양회수 계획·실적 이력이 비어 있습니다. 최신 회차를 올리세요.',
    );
  });
});
