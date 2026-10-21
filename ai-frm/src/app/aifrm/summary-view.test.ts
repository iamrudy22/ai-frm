import { describe, it, expect } from 'vitest';
import { adequateCashTile, fundingRiskTile, gapTile, perceptionTile, recoveryBasis, recoveryTile, reportReadiness } from '@/app/aifrm/summary-view';
import type { PerceptionReportDto, PerceptionResponse } from '@/app/api/construction-perception/dto';
import type { FundingRiskReportDto, FundingRiskResponse } from '@/app/api/funding-risk/dto';
import { assessDashboard } from '@/application/dashboard';
import { createStatement } from '@/domain/cashflow/statement';
import { assessLiquidityGap } from '@/domain/risk/liquidity-gap/liquidity-gap';
import { perceptionIndex } from '@/domain/risk/construction-perception/policy';
import { spread } from '@/domain/risk/funding-risk/policy';
import { amount } from '@/domain/shared/amount';
import { calendarDate } from '@/domain/shared/calendar-date';
import { yearMonth } from '@/domain/shared/year-month';

const ym = (s: string) => s as never;

describe('요약 — 대금 회수 위험', () => {
  // 7월 판단은 7월 회차에 적힌 가장 최근 실적(6월)을 6월 회차의 6월 계획과 견준다.
  it('판정했으면 등급, 회수율, 판단월과 실적 기준월', () => {
    const tile = recoveryTile({ ok: true, value: { kind: 'ok', rate: 0.989, grade: '정상' } as never }, {
      judged: ym('2026/07'),
      target: ym('2026/06'),
      previousRound: ym('2026/06'),
    });
    expect(tile).toEqual({
      title: '대금 회수 위험',
      status: { kind: 'grade', grade: '정상' },
      value: '98.9%',
      note: '회수율 · 2026/07 판단 · 2026/06 실적 기준',
    });
  });

  it('판단월은 최신 회차의 달, 실적 기준월은 그 직전 달이다', () => {
    expect(recoveryBasis(ym('2026/07'), ym('2026/06'))).toBe('2026/07 판단 · 2026/06 실적 기준');
    expect(recoveryBasis(ym('2026/07'), null)).toBe('2026/07 판단');
  });

  it('이전 회차가 없으면 판정 안 함과 빠진 회차', () => {
    expect(recoveryTile(null, { judged: ym('2026/08'), target: null, previousRound: ym('2026/07') })).toEqual({
      title: '대금 회수 위험',
      status: { kind: 'dot', variant: 'neutral', label: '판정 안 함' },
      value: '—',
      note: '2026/07 회차 없음 · 함께 등록하세요',
    });
  });

  it('판정하지 못했으면 판정 불가', () => {
    expect(recoveryTile({ ok: false, reason: 'x' }, { judged: ym('2026/08'), target: null, previousRound: ym('2026/07') })).toMatchObject({
      status: { kind: 'dot', variant: 'error', label: '판정 불가' },
      value: '—',
      note: '원본 항목·회차 확인 후 다시 등록',
    });
  });

  it('연초 판단의 부족 회차는 전달인 전년도 12월로 안내한다', () => {
    expect(recoveryTile(null, { judged: ym('2027/01'), target: null, previousRound: ym('2026/12') }))
      .toMatchObject({ value: '—', note: '2026/12 회차 없음 · 함께 등록하세요' });
  });

  it.each(['항목을 읽지 못했습니다.', '계획값이 0입니다.', '예상하지 못한 합성 원문: 503/미발표/회차'])
    ('구조화되지 않은 로컬 사유 %s를 추측해 재분류하지 않고 원본 확인을 안내한다', (reason) => {
      const failed = { ok: false as const, reason };
      for (const tile of [
        recoveryTile(failed, { judged: ym('2026/08'), target: null, previousRound: ym('2026/07') }),
        gapTile(failed, '2026/08~2026/10'),
        adequateCashTile(failed, '2026/08~2026/10'),
      ]) {
        expect(tile).toMatchObject({ value: '—', note: '원본 항목·회차 확인 후 다시 등록' });
      }
    });
});

describe('요약 — 유동성 Gap', () => {
  it('순지출이면 등급과 Gap 비율, 관측 구간', () => {
    expect(gapTile({ ok: true, value: { kind: 'gap', gapRatio: 1.69, grade: '정상' } as never }, '2026/08~2026/10')).toEqual({
      title: '유동성 Gap',
      status: { kind: 'grade', grade: '정상' },
      value: '169.0%',
      note: '2026/08~2026/10',
    });
  });

  it('순유입이면 비율 대신 순유입', () => {
    expect(gapTile({ ok: true, value: { kind: 'net-inflow', grade: '정상' } as never }, '2026/08~2026/10')).toMatchObject({
      value: '순유입',
      note: '2026/08~2026/10',
    });
  });

  it('산출하지 못했으면 산출 불가', () => {
    expect(gapTile({ ok: false, reason: 'x' }, '—').status).toEqual({ kind: 'dot', variant: 'error', label: '산출 불가' });
  });
});

describe('요약 — 적정 시재 (등급 없음)', () => {
  it('안정적이면 T와 초록 점, 여유분(+)은 보조 문장에', () => {
    expect(adequateCashTile({ ok: true, value: { isAdequate: true, surplus: 92603.4 } as never }, '2026/08~2026/10')).toEqual({
      title: '적정 시재',
      status: { kind: 'dot', variant: 'success', label: '안정적' },
      value: 'T',
      note: '현재 − 적정 +92,603 억원 · 2026/08~2026/10',
    });
  });

  it('부족하면 F와 경고 점, 부족분(−)', () => {
    expect(adequateCashTile({ ok: true, value: { isAdequate: false, surplus: -1234 } as never }, 's')).toMatchObject({
      status: { kind: 'dot', variant: 'warning', label: '적정시재 부족' },
      value: 'F',
      note: '현재 − 적정 −1,234 억원 · s',
    });
  });
});

describe('요약 — 건설경기 인식 지수', () => {
  const ok = (result: unknown) => ({ ok: true as const, value: { result } as never });

  it('불러오는 중', () => {
    expect(perceptionTile(null)).toMatchObject({ status: { kind: 'dot', variant: 'neutral', label: '불러오는 중' }, value: '…' });
  });

  it('기준월 재조회 중에는 이전 지수와 등급을 현재 결과처럼 보이지 않는다', () => {
    expect(perceptionTile(ok({ kind: 'ok', month: '2026/06', index: 11.4321, grade: '정상' }), true, ym('2026/07'))).toEqual({
      title: '건설경기 인식 지수',
      status: { kind: 'dot', variant: 'neutral', label: '불러오는 중' },
      value: '…',
      note: 'ECOS 조회 중 · 요청 기준월 2026/07 · 이전 결과 기준월 2026/06',
    });
  });

  it('실패 후 같은 요청을 다시 조회하는 동안 이전 실패를 현재 결과처럼 보이지 않는다', () => {
    expect(perceptionTile({ ok: false, reason: '연결 실패' }, true, ym('2026/07'))).toMatchObject({
      status: { kind: 'dot', variant: 'neutral', label: '불러오는 중' },
      value: '…',
      note: 'ECOS 조회 중 · 요청 기준월 2026/07',
    });
  });

  it('기본 기준월을 다시 조회하면 이전 결과의 기준월만 안내한다', () => {
    expect(perceptionTile(ok({ kind: 'unavailable', month: '2026/06', missing: [{}] }), true)).toMatchObject({
      status: { kind: 'dot', variant: 'neutral', label: '불러오는 중' },
      value: '…',
      note: 'ECOS 조회 중 · 이전 결과 기준월 2026/06',
    });
  });

  it('산출했으면 종합위기단계와 지수, 기준월', () => {
    expect(perceptionTile(ok({ kind: 'ok', month: '2026/06', index: 11.4321, grade: '정상' }))).toEqual({
      title: '건설경기 인식 지수',
      status: { kind: 'grade', grade: '정상' },
      value: '11.43',
      note: '종합위기인식지수 · 기준월 2026/06',
    });
  });

  it('산출불가면 구조화된 결측 개수와 지표명으로 요약하고 긴 원문 사유는 상세에서 확인하게 한다', () => {
    expect(perceptionTile(ok({ kind: 'unavailable', month: '2026/06', missing: [
      { key: '분양회수예측오차', reason: '합성 회차 자료가 없습니다.' },
      { key: '총수주액', reason: '합성 원값이 없습니다.' },
      { key: '선행지수순환변동치', reason: '합성 비교값이 없습니다.' },
    ] }))).toMatchObject({
      status: { kind: 'dot', variant: 'warning', label: '산출불가' },
      value: '—',
      note: '기준월 2026/06 · 3개 지표 값 없음(분양회수 예측오차 등) · 상세 사유 확인',
    });
  });

  it('요청이 실패했으면 산출 불가', () => {
    expect(perceptionTile({ ok: false, reason: '임의의 요청 처리 사유' })).toMatchObject({
      status: { kind: 'dot', variant: 'error', label: '산출 불가' },
      value: '—',
      note: '요청 처리 실패 · 상세에서 다시 불러오기',
    });
  });

  it('결측이 하나이면 해당 지표명만 보여 주고 값 부재 원인을 단정하지 않는다', () => {
    expect(perceptionTile(ok({ kind: 'unavailable', month: '2026/06', missing: [
      { key: '선행지수순환변동치', reason: '실패인지 공표 전인지 구분할 수 없는 원문' },
    ] }))).toMatchObject({
      note: '기준월 2026/06 · 1개 지표 값 없음(선행지수 순환변동치) · 상세 사유 확인',
    });
  });

  it('재조회 중인 이전 결측 지표와 사유를 현재의 보완 안내로 노출하지 않는다', () => {
    expect(perceptionTile(ok({ kind: 'unavailable', month: '2026/06', missing: [
      { key: '주가', reason: '이전 주가 원문 사유' },
    ] }), true, ym('2026/07'))).toMatchObject({
      value: '…',
      note: 'ECOS 조회 중 · 요청 기준월 2026/07 · 이전 결과 기준월 2026/06',
    });
  });
});

describe('요약 — 조달위험 인식 지수', () => {
  const ok = {
    kind: 'ok',
    judgedMonth: '2026/08',
    observedMonth: '2026/07',
    evaluationDate: '2026/07/31',
    monthEnd: '2026/07/31',
    spread: 0.281,
    grade: '주의',
  } as never;

  it('판정했으면 등급, 금리 차이, 판단월과 쓴 평가일', () => {
    expect(fundingRiskTile({ ok: true, value: { source: '회차', result: ok, fetchedAt: '2026-09-28T00:00:00.000Z' } })).toEqual({
      title: '조달위험 인식 지수',
      status: { kind: 'grade', grade: '주의' },
      value: '0.281%p',
      note: '공사채 AAA − 국고채 · 2026/08 판단 · 2026/07/31 금리',
    });
  });

  it('불러오는 중', () => {
    expect(fundingRiskTile(null)).toMatchObject({ status: { kind: 'dot', variant: 'neutral' }, value: '…' });
  });

  it.each([
    { fetchedAt: null, guidance: '상세에서 다시 불러오기' },
    { fetchedAt: '2026-09-01T00:00:00.000Z', guidance: '상세 사유 확인' },
  ])('산출불가면 판단·관측월을 유지하고 기존 재조회 가능 여부에 맞춰 안내한다: $guidance', ({ fetchedAt, guidance }) => {
    const unavailable = { kind: 'unavailable', judgedMonth: '2026/08', observedMonth: '2026/07', reason: '아직 말일이 지나지 않았거나 자료가 비어 있습니다.' } as never;
    expect(fundingRiskTile({ ok: true, value: { source: '회차', result: unavailable, fetchedAt } })).toMatchObject({
      status: { kind: 'dot', variant: 'warning', label: '산출불가' },
      value: '—',
      note: `2026/08 판단 · 2026/07 금리 자료 확인 · ${guidance}`,
    });
  });

  it('요청이 실패했으면 산출 불가', () => {
    expect(fundingRiskTile({ ok: false, reason: '임의의 요청 처리 사유' })).toMatchObject({
      status: { kind: 'dot', variant: 'error', label: '산출 불가' },
      value: '—',
      note: '요청 처리 실패 · 상세에서 다시 불러오기',
    });
  });
});

describe('보고서 준비 상태 — 기존 지표 결과의 집계', () => {
  const reportMonth = yearMonth(2026, 8);
  const baseMonth = yearMonth(2026, 6);
  const statement = (month: number) => {
    const values = Array.from({ length: 12 }, () => amount(100));
    return createStatement({
      asOf: new Date(2026, month - 1, 10),
      monthLabels: Array.from({ length: 12 }, (_, index) => `${index + 1}월`),
      baseMonthIndex: month - 1,
      planYearEndIndex: 11,
      amounts: { 기초시재: values, 수입계: values, 수입: values, 분양회수: values, 기타수입: values, 지출: values },
    });
  };
  const latest = statement(8);
  const dashboard = assessDashboard(statement(7), latest, latest.defaultBaseMonth);
  const perceptionResponse = (result: PerceptionReportDto['result'] = {
    kind: 'ok', month: baseMonth, index: perceptionIndex(10), grade: '정상', lines: [],
  }): PerceptionResponse => ({
    ok: true,
    value: {
      basis: { baseMonth, reportMonth, source: '회차' },
      selectable: { from: yearMonth(2026, 5), to: yearMonth(2026, 7) },
      result,
      diagnostics: {
        indicators: [], ledger: { latestRound: reportMonth, rounds: [yearMonth(2026, 7), reportMonth] },
        fetchedAt: '2026-09-01T00:00:00.000Z',
      },
    },
  });
  const fundingResponse = (result: FundingRiskReportDto['result'] = {
    kind: 'ok', judgedMonth: reportMonth, observedMonth: yearMonth(2026, 7),
    evaluationDate: calendarDate(2026, 7, 31), monthEnd: calendarDate(2026, 7, 31),
    publicAaa: { average: 3.2, byAgency: { 나이스피앤아이: 3.2, 한국자산평가: 3.2, KIS자산평가: 3.2 } },
    treasury: { average: 3, byAgency: { 나이스피앤아이: 3, 한국자산평가: 3, KIS자산평가: 3 } },
    spread: spread(0.2), grade: '정상',
  }): FundingRiskResponse => ({ ok: true, value: { source: '회차', result, fetchedAt: '2026-09-01T00:00:00.000Z' } });
  const unavailablePerception = perceptionResponse({
    kind: 'unavailable', month: baseMonth, missing: [{ key: '총수주액', reason: '해당 월 자료가 없습니다.' }],
  });
  const unavailableFunding = fundingResponse({
    kind: 'unavailable', judgedMonth: reportMonth, observedMonth: yearMonth(2026, 7), reason: '금리 값이 없습니다.',
  });

  it('다섯 지표의 결과가 있으면 모두 산출 완료로 집계한다', () => {
    expect(reportReadiness(dashboard, perceptionResponse(), false, fundingResponse()))
      .toEqual({ completed: 5, loading: 0, unavailable: 0 });
  });

  it('외부 자료를 처음 조회할 때는 엑셀 지표 세 개만 완료다', () => {
    expect(reportReadiness(dashboard, null, false, null))
      .toEqual({ completed: 3, loading: 2, unavailable: 0 });
  });

  it.each([perceptionResponse(), { ok: false as const, reason: '이전 연결 실패' }, unavailablePerception])(
    'ECOS 재조회 중에는 이전 응답 %j를 현재의 완료·불가 개수에 넣지 않는다', (previous) => {
      expect(reportReadiness(dashboard, previous, true, fundingResponse()))
        .toEqual({ completed: 4, loading: 1, unavailable: 0 });
    },
  );

  it.each([
    { perception: { ok: false as const, reason: '외부 연결 실패' }, funding: { ok: false as const, reason: '외부 연결 실패' } },
    { perception: unavailablePerception, funding: unavailableFunding },
  ])('외부 응답의 실패와 값 부재는 모두 산출 불가로 집계한다: %j', ({ perception, funding }) => {
    expect(reportReadiness(dashboard, perception, false, funding))
      .toEqual({ completed: 3, loading: 0, unavailable: 2 });
  });

  it('직전 회차가 없거나 엑셀 항목 판독에 실패하면 해당 지표를 산출 불가로 센다', () => {
    expect(reportReadiness({
      ...dashboard, paymentRecovery: null,
      liquidityGap: { ok: false, reason: '수입 항목 없음' },
      adequateCash: { ok: false, reason: '지출 항목 없음' },
    }, perceptionResponse(), false, fundingResponse()))
      .toEqual({ completed: 2, loading: 0, unavailable: 3 });
    expect(reportReadiness({ ...dashboard, paymentRecovery: { ok: false, reason: '연속 회차가 아닙니다.' } }, null, false, null))
      .toEqual({ completed: 2, loading: 2, unavailable: 1 });
  });

  it('순유입·적정 시재 F·위기 등급도 판정된 결과이므로 산출 완료다', () => {
    if (!dashboard.adequateCash.ok) throw new Error('합성 시재 결과가 필요합니다.');
    expect(reportReadiness({
      ...dashboard,
      liquidityGap: { ok: true, value: assessLiquidityGap({ openingCash: amount(10), income: amount(200), expense: amount(100) }) },
      adequateCash: { ok: true, value: { ...dashboard.adequateCash.value, isAdequate: false, surplus: amount(-10) } },
    }, perceptionResponse({ kind: 'ok', month: baseMonth, index: perceptionIndex(90), grade: '위기', lines: [] }), false, fundingResponse()))
      .toEqual({ completed: 5, loading: 0, unavailable: 0 });
  });

  it('완료·조회 중·산출 불가의 합은 항상 지표 다섯 개다', () => {
    for (const perception of [null, perceptionResponse(), unavailablePerception, { ok: false as const, reason: '합성 실패' }]) {
      for (const funding of [null, fundingResponse(), unavailableFunding, { ok: false as const, reason: '합성 실패' }]) {
        for (const loading of [false, true]) {
          const readiness = reportReadiness(dashboard, perception, loading, funding);
          expect(readiness.completed + readiness.loading + readiness.unavailable).toBe(5);
        }
      }
    }
  });
});
