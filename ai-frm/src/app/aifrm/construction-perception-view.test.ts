import { describe, it, expect } from 'vitest';
import type { PerceptionReportDto } from '@/app/api/construction-perception/dto';
import {
  basisNote,
  batchRecordedText,
  changeText,
  indicatorRows,
  ledgerNote,
  missingRows,
  monthOptions,
  revisionNote,
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
      ledger: { latestRound: '2026/08' as never, rounds: ['2026/05', '2026/06', '2026/07', '2026/08'] as never, missingRounds: [] },
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

describe('기준월 설명 (정책 §5, 2026-09-28 개정)', () => {
  const basis = (over: Partial<PerceptionReportDto['basis']>): PerceptionReportDto['basis'] => ({
    baseMonth: '2026/07' as never,
    reportMonth: '2026/09' as never,
    source: '오늘',
    ...over,
  });

  it('회차를 올렸으면 회차가 보고월이다', () => {
    expect(basisNote(basis({ baseMonth: '2026/06' as never, reportMonth: '2026/08' as never, source: '회차' }))).toBe(
      '보고월 2026/08(최신 회차) → 기준월 2026/06',
    );
  });

  it('회차가 없으면 오늘이 보고월이다', () => {
    expect(basisNote(basis({}))).toBe('보고월 2026/09(오늘) → 기준월 2026/07');
  });

  it('직접 골랐으면 기본값도 함께 알린다', () => {
    expect(basisNote(basis({ baseMonth: '2026/05' as never, reportMonth: '2026/08' as never, source: '선택' }))).toBe(
      '직접 고른 기준월 2026/05 · 기본값은 보고월 2026/08 − 2 = 2026/06',
    );
  });

  it('보고월 없이 골랐으면 고른 달만 알린다', () => {
    expect(basisNote(basis({ baseMonth: '2026/05' as never, reportMonth: null, source: '선택' }))).toBe(
      '직접 고른 기준월 2026/05',
    );
  });
});

describe('과거 달 알림', () => {
  // 지금의 기본 기준월(오늘 − 2)보다 앞선 달은 그동안 수정된 ECOS 값으로 계산된다.
  it('지금의 기본 기준월보다 앞선 달이면 알린다', () => {
    const r = report({ basis: { baseMonth: '2026/06' as never, reportMonth: '2026/08' as never, source: '회차' } });
    expect(revisionNote(r)).toBe(
      'ECOS 현재 값으로 계산합니다. 잠정치 수정이나 기준연도 개편으로 당시 보고한 값과 다를 수 있습니다.',
    );
  });

  it('지금의 기본 기준월이면 알리지 않는다', () => {
    expect(revisionNote(report())).toBeNull();
  });
});

describe('기준월 선택지', () => {
  it('고를 수 있는 범위를 최신 달부터 늘어놓는다', () => {
    expect(monthOptions({ from: '2026/05' as never, to: '2026/08' as never }, '2026/07' as never)).toEqual([
      '2026/08',
      '2026/07',
      '2026/06',
      '2026/05',
    ]);
  });

  it('지금 기준월이 범위 밖이어도 선택지에 넣는다 — 선택 상자가 비지 않게', () => {
    expect(monthOptions({ from: '2026/05' as never, to: '2026/06' as never }, '2026/07' as never)).toEqual([
      '2026/07',
      '2026/06',
      '2026/05',
    ]);
  });

  it('이력이 비어 범위의 시작이 없으면 지금 기준월만', () => {
    expect(monthOptions({ from: null, to: '2026/08' as never }, '2026/07' as never)).toEqual(['2026/07']);
  });
});

describe('이력 안내 (회차 단위)', () => {
  const ledger = (rounds: string[], missingRounds: string[] = []) => ({
    latestRound: (rounds.at(-1) ?? null) as never,
    rounds: rounds as never,
    missingRounds: missingRounds as never,
  });

  it('올라온 회차 범위와, 기준월에 필요한 두 회차가 다 있음을 알린다', () => {
    expect(ledgerNote(ledger(['2026/01', '2026/02', '2026/03', '2026/04', '2026/05', '2026/06', '2026/07', '2026/08']), '2026/07' as never)).toBe(
      '분양회수 계획·실적 이력: 2026/01~2026/08 회차 8개. 기준월 2026/07에 필요한 2026/04~2026/07 회차가 모두 있습니다.',
    );
  });

  it('필요한 회차가 없으면 무엇을 올릴지 알린다', () => {
    expect(ledgerNote(ledger(['2026/05', '2026/06']), '2026/07' as never)).toBe(
      '분양회수 계획·실적 이력: 2026/05~2026/06 회차 2개. 기준월 2026/07에는 2026/04~2026/07 회차가 필요합니다 — 2026/04·2026/07 회차를 올리세요.',
    );
  });

  it('사이에 빠진 회차도 알린다', () => {
    expect(ledgerNote(ledger(['2026/04', '2026/07'], ['2026/05', '2026/06']), '2026/06' as never)).toBe(
      '분양회수 계획·실적 이력: 2026/04~2026/07 회차 2개, 빠진 회차 2026/05·2026/06. 기준월 2026/06에는 2026/03~2026/06 회차가 필요합니다 — 2026/03·2026/05·2026/06 회차를 올리세요.',
    );
  });

  it('이력이 비어 있으면 회차를 올리라고 알린다', () => {
    expect(ledgerNote(ledger([]), '2026/07' as never)).toBe(
      '분양회수 계획·실적 이력이 비어 있습니다. 기준월 2026/07에는 2026/04~2026/07 회차가 필요합니다.',
    );
  });
});

describe('여러 회차 반영 결과', () => {
  it('반영한 회차를 달 순서로 알린다', () => {
    expect(
      batchRecordedText([
        { file: 'b.xlsx', round: '2026/05' as never },
        { file: 'a.xlsx', round: '2026/04' as never },
      ]),
    ).toEqual({ status: 'success', text: '회차 2개를 반영했습니다: 2026/04·2026/05.' });
  });

  it('반영하지 못한 파일은 사유와 함께 알리고, 경고로 보인다', () => {
    expect(
      batchRecordedText([
        { file: 'a.xlsx', round: '2026/04' as never },
        { file: 'x.xlsx', reason: '시트를 찾을 수 없습니다.' },
      ]),
    ).toEqual({
      status: 'warning',
      text: '회차 1개를 반영했습니다: 2026/04. 반영하지 못한 파일: x.xlsx — 시트를 찾을 수 없습니다.',
    });
  });

  it('하나도 반영하지 못했으면', () => {
    expect(batchRecordedText([{ file: 'x.xlsx', reason: '깨진 파일' }])).toEqual({
      status: 'warning',
      text: '반영한 회차가 없습니다. 반영하지 못한 파일: x.xlsx — 깨진 파일',
    });
  });
});
