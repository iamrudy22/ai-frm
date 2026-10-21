import { describe, expect, it } from 'vitest';
import type { PerceptionResponse } from '@/app/api/construction-perception/dto';
import type { FundingRiskResponse } from '@/app/api/funding-risk/dto';
import { assessDashboard } from '@/application/dashboard';
import { createStatement, unreadable, type ItemName, type ItemSeries, type Statement } from '@/domain/cashflow/statement';
import { perceptionIndex } from '@/domain/risk/construction-perception/policy';
import { assessFundingRisk } from '@/domain/risk/funding-risk/funding-risk';
import { amount } from '@/domain/shared/amount';
import { calendarDate } from '@/domain/shared/calendar-date';
import { parseYearMonth as ym } from '@/domain/shared/year-month';
import { arrangeRounds } from './uploaded-rounds';
import { buildFinancialReport, type FinancialReport, type FinancialReportInput, type ReportMetric } from './report-model';

// 모두 합성 회차다. 원본 보고서의 사내 값은 테스트에 사용하지 않는다.
const labels = [...Array.from({ length: 12 }, (_, i) => `${i + 1}월`), '다음해 1월', '다음해 2월'];
const series = (values: number[]) => values.map(amount);
const flat = (value: number) => series(labels.map(() => value));

function statement(month: number, over: Partial<Record<ItemName, ItemSeries>> = {}, year = 2026): Statement {
  return createStatement({
    asOf: new Date(year, month - 1, 10), monthLabels: labels, baseMonthIndex: month - 1, planYearEndIndex: 11,
    amounts: {
      기초시재: series(labels.map((_, i) => 1_000 - i * 20)),
      수입계: flat(80), 수입: flat(80), 분양회수: flat(10), 기타수입: flat(0), 지출: flat(100),
      ...over,
    },
  });
}

function input(statements: Statement[], overrides: Partial<FinancialReportInput> = {}): FinancialReportInput {
  const arranged = arrangeRounds(statements.map((s, i) => ({ file: `synthetic-${i}.xlsx`, statement: s })));
  if (!arranged.ok) throw new Error(arranged.reason);
  return {
    rounds: arranged.rounds,
    dashboard: assessDashboard(arranged.previous?.statement ?? null, arranged.latest.statement, arranged.latest.statement.defaultBaseMonth),
    gapMonth: arranged.latest.round,
    perception: null, funding: null, generatedAt: new Date('2026-10-20T15:30:00Z'), ...overrides,
  };
}

function metric(report: FinancialReport, id: ReportMetric['id']): ReportMetric {
  const result = report.metrics.find((m) => m.id === id);
  if (!result) throw new Error(`지표가 없습니다: ${id}`);
  return result;
}

function perception(index = 12.345): PerceptionResponse {
  return {
    ok: true,
    value: {
      basis: { baseMonth: ym('2026/06'), reportMonth: ym('2026/08'), source: '회차' },
      selectable: { from: ym('2026/06'), to: ym('2026/09') },
      result: { kind: 'ok', month: ym('2026/06'), index: perceptionIndex(index), grade: '정상', lines: [] },
      diagnostics: { indicators: [], ledger: { latestRound: ym('2026/08'), rounds: [ym('2026/05'), ym('2026/08')] }, fetchedAt: '2026-10-20T12:00:00Z' },
    },
  };
}

function funding(publicRate = 3.123, treasuryRate = 3.003): FundingRiskResponse {
  const bond = (average: number) => ({ average, byAgency: { 나이스피앤아이: average, 한국자산평가: average, KIS자산평가: average } });
  return {
    ok: true,
    value: {
      source: '회차', fetchedAt: '2026-10-20T12:00:00Z',
      result: assessFundingRisk(ym('2026/08'), [{ date: calendarDate(2026, 7, 31), publicAaa: bond(publicRate), treasury: bond(treasuryRate) }]),
    },
  };
}

describe('보고서의 기준월과 표시 단위', () => {
  it('건설경기 설명은 응답의 관측 변화율과 정책의 비교 기간으로 작성한다', () => {
    const response = perception();
    if (!response.ok || response.value.result.kind !== 'ok') throw new Error('합성 결과 오류');
    const report = buildFinancialReport(input([statement(7), statement(8)], {
      perception: { ...response, value: { ...response.value, result: {
        ...response.value.result,
        lines: [
          { key: '총수주액', change: -0.12, contribution: 0, score: 0 },
          { key: '설비투자지수', change: 0.08, contribution: 0, score: 0 },
        ],
      } } },
    }));
    const text = metric(report, 'construction').narrative;
    expect(text).toContain('총수주액은 전년 동월 대비 12.00% 감소');
    expect(text).toContain('설비투자지수는 전월 대비 8.00% 증가');
    expect(text).not.toContain('주택건설인허가실적');
  });
  it('빈 양식은 지표 5개를 산출 전으로 보이고 수치를 만들지 않는다', () => {
    const report = buildFinancialReport();
    expect(report.isTemplate).toBe(true);
    expect(report.title).toBe('재무위험관리시스템 현황 보고 (양식)');
    expect(report.reportMonth).toBe('—');
    expect(report.latestRound).toBe('—');
    expect(report.metrics).toHaveLength(5);
    for (const m of report.metrics) {
      expect(m.value).toBe('—');
      expect(m.status).toBe('산출 전');
      expect(m.grade).toBeNull();
      expect(m.points).toEqual([]);
    }
    const empty = buildFinancialReport(input([statement(8)], { rounds: [], generatedAt: new Date('2026-10-31T15:30:00Z') }));
    expect(empty.reportMonth).toBe('—');
    expect(empty.generatedOn).toBe('2026.11.01');
    expect(empty.isTemplate).toBe(true);
  });

  it('보고월·실적월·선택 기준월·외부 관측월을 각각 표시하고 작성일은 한국시간으로 정한다', () => {
    const july = statement(7);
    const august = statement(8);
    const chosen = ym('2026/09');
    const report = buildFinancialReport(input([august, july], {
      gapMonth: chosen, dashboard: assessDashboard(july, august, august.months[8]),
      perception: perception(), funding: funding(),
    }));
    expect(report.reportMonth).toBe('2026/07');
    expect(report.title).toBe('재무위험관리시스템 현황 보고 (2026/07)');
    expect(report.latestRound).toBe('2026/08');
    expect(report.generatedOn).toBe('2026.10.21');
    expect(metric(report, 'recovery').basis).toContain('2026/07 실적');
    expect(metric(report, 'recovery').points.at(-1)?.month).toBe('2026/07');
    expect(metric(report, 'liquidity').basis).toContain('2026/09~2026/11');
    expect(metric(report, 'cash').basis).toContain('2026/09~2026/11');
    expect(metric(report, 'construction').points).toEqual([{ month: '2026/06', value: 12.345 }]);
    expect(metric(report, 'funding').points[0].month).toBe('2026/07');
    expect(metric(report, 'funding').basis).toContain('판단월 2026/08');
  });

  it('비율은 소수 두 자리, 금리 차이는 %p 세 자리, 시재는 억원으로 표시한다', () => {
    const report = buildFinancialReport(input([statement(7), statement(8)], { perception: perception(), funding: funding() }));
    expect(metric(report, 'recovery').value).toBe('1.00');
    expect(metric(report, 'liquidity').value).toBe('14.33');
    expect(metric(report, 'construction').value).toBe('12.35');
    expect(metric(report, 'funding').value).toBe('0.120%p');
    expect(metric(report, 'cash').value).toBe('60 억원');
    expect(metric(report, 'cash').grade).toBeNull();
    expect(metric(report, 'cash').status).toBe('안정적');
    expect(metric(report, 'cash').points.at(-1)).toEqual({ month: '2026/08', value: 860, secondary: 60 });
    expect(report.metrics.every((m) => !/전월보다|줄고 있습니다|벌어지고 있습니다|추세입니다/.test(m.narrative))).toBe(true);
  });

  it('연초 최신 회차의 보고월은 전년도 말이다', () => {
    const report = buildFinancialReport(input([statement(1)]));
    expect(report.reportMonth).toBe('2025/12');
    expect(metric(report, 'recovery').basis).toContain('2025/12 실적');
  });

  it('큰 금액은 설명에서 조원으로 읽되 원래 억원 계열을 유지한다', () => {
    const report = buildFinancialReport(input([statement(8, { 기초시재: flat(20_000), 수입: flat(1_000), 지출: flat(10_000) })]));
    expect(metric(report, 'liquidity').narrative).toContain('2.7조원');
    expect(metric(report, 'liquidity').narrative).toContain('2조원');
    expect(metric(report, 'cash').points.at(-1)?.value).toBe(20_000);
  });
});

describe('보고서 이력의 결측과 당시 회차 보존', () => {
  it('직전 회차가 없으면 떨어진 회차로 회수율을 만들지 않는다', () => {
    const report = buildFinancialReport(input([statement(5), statement(8)]));
    expect(metric(report, 'recovery').value).toBe('—');
    expect(metric(report, 'recovery').narrative).toContain('2026/07 회차가 없어');
    expect(metric(report, 'recovery').points.at(-1)).toEqual({ month: '2026/07', value: null });
    expect(metric(report, 'liquidity').value).not.toBe('—');
  });

  it('회차 사이 빠진 달은 0이 아닌 null로 두어 차트가 이어지지 않게 한다', () => {
    const report = buildFinancialReport(input([statement(5), statement(8)]));
    expect(metric(report, 'liquidity').points).toEqual([
      { month: '2026/05', value: 920 / 60 }, { month: '2026/06', value: null },
      { month: '2026/07', value: null }, { month: '2026/08', value: 860 / 60 },
    ]);
    expect(metric(report, 'cash').points[1]).toEqual({ month: '2026/06', value: null, secondary: null });
  });

  it('최신 회차에 수정된 과거 값이 있어도 이전 회차 당시 이력을 바꾸지 않는다', () => {
    const june = statement(6, { 분양회수: flat(20) });
    const july = statement(7, { 분양회수: flat(10), 기초시재: flat(600) });
    const august = statement(8, { 분양회수: flat(15), 기초시재: flat(9_000), 수입: flat(0) });
    const report = buildFinancialReport(input([august, june, july]));
    const recovery = metric(report, 'recovery').points;
    expect(recovery.find((p) => p.month === '2026/06')?.value).toBe(0.5);
    expect(recovery.find((p) => p.month === '2026/07')?.value).toBe(1.5);
    const gap = metric(report, 'liquidity').points;
    expect(gap.find((p) => p.month === '2026/07')?.value).toBe(10);
    expect(gap.find((p) => p.month === '2026/08')?.value).toBe(30);
    expect(metric(report, 'cash').points.find((p) => p.month === '2026/07')?.value).toBe(600);
    expect(metric(report, 'cash').historyNote).toContain('당시 계획');
  });

  it('미래 기준월을 선택해도 당시 회차 이력은 유지하고 본문만 선택한 월로 산출한다', () => {
    const july = statement(7);
    const august = statement(8);
    const defaultReport = buildFinancialReport(input([july, august]));
    const report = buildFinancialReport(input([july, august], {
      gapMonth: ym('2026/09'), dashboard: assessDashboard(july, august, august.months[8]),
    }));
    expect(metric(report, 'liquidity').points).toEqual(metric(defaultReport, 'liquidity').points);
    expect(metric(report, 'cash').points).toEqual(metric(defaultReport, 'cash').points);
    expect(metric(report, 'liquidity').value).toBe('14.00');
    expect(metric(report, 'liquidity').basis).toContain('2026/09~2026/11');
    expect(metric(report, 'cash').narrative).toContain('현재 시재 840 억원');
    expect(metric(report, 'cash').narrative).toContain('계획 이월 잔고');
    expect(metric(report, 'cash').basis).toContain('2026/09~2026/11');
    for (const id of ['liquidity', 'cash'] as const) {
      expect(metric(report, id).historyNote).toContain('추이는 회차 기준월의 당시 계획이며, 본문 선택 기준월과 다릅니다');
    }
    expect(metric(report, 'recovery').historyNote).not.toContain('본문 선택 기준월');
  });

  it('이전 기준월을 선택해도 최신 회차의 수정값으로 이전 회차 이력을 덮어쓰지 않는다', () => {
    const july = statement(7, { 기초시재: flat(600) });
    const august = statement(8, { 기초시재: flat(9_000), 수입: flat(0), 분양회수: flat(20) });
    const defaultReport = buildFinancialReport(input([july, august]));
    const report = buildFinancialReport(input([july, august], {
      gapMonth: ym('2026/07'), dashboard: assessDashboard(july, august, august.months[6]),
    }));
    expect(metric(report, 'liquidity').points).toEqual(metric(defaultReport, 'liquidity').points);
    expect(metric(report, 'cash').points).toEqual(metric(defaultReport, 'cash').points);
    expect(metric(report, 'liquidity').points).toEqual([
      { month: '2026/07', value: 10 }, { month: '2026/08', value: 30 },
    ]);
    expect(metric(report, 'cash').points).toEqual([
      { month: '2026/07', value: 600, secondary: 60 }, { month: '2026/08', value: 9_000, secondary: 162 },
    ]);
    expect(metric(report, 'liquidity').value).toBe('30.00');
    expect(metric(report, 'cash').value).toBe('162 억원');
    expect(metric(report, 'liquidity').basis).toContain('2026/07~2026/09');
    expect(metric(report, 'cash').basis).toContain('2026/07~2026/09');
    expect(metric(report, 'recovery').points).toEqual(metric(defaultReport, 'recovery').points);
  });

  it('이력은 최대 18개월로 제한하고 외부 지표의 과거 점은 만들지 않는다', () => {
    const report = buildFinancialReport(input([statement(1, {}, 2024), statement(8)], { perception: perception(0), funding: funding(3, 3) }));
    expect(metric(report, 'liquidity').points).toHaveLength(18);
    expect(metric(report, 'liquidity').points[0]).toEqual({ month: '2025/03', value: null });
    expect(metric(report, 'construction').points).toEqual([{ month: '2026/06', value: 0 }]);
    expect(metric(report, 'funding').points).toEqual([{ month: '2026/07', value: 0 }]);
    expect(metric(report, 'construction').historyNote).toContain('과거 산출 이력 미조회');
    expect(metric(report, 'funding').historyNote).toContain('과거 산출 이력 미조회');
  });
});

describe('보고서의 실패·로딩·음수 처리', () => {
  it('하나의 항목 판독 실패가 다른 지표 산출까지 막지 않는다', () => {
    const report = buildFinancialReport(input([statement(7), statement(8, { 기타수입: unreadable('합성 누락값') })], { perception: perception(), funding: funding() }));
    expect(metric(report, 'cash').value).toBe('—');
    expect(metric(report, 'cash').narrative).toContain('합성 누락값');
    expect(metric(report, 'cash').points.at(-1)?.value).toBeNull();
    expect(metric(report, 'recovery').value).toBe('1.00');
    expect(metric(report, 'liquidity').value).not.toBe('—');
    expect(metric(report, 'construction').value).not.toBe('—');
    expect(metric(report, 'funding').value).not.toBe('—');
    expect(report.warnings).toContain('읽지 못한 항목 1개 (기타수입): 대시보드에서 상세 확인하세요.');
    expect(report.warnings.some((warning) => warning.includes('합성 누락값'))).toBe(false);
  });

  it('기준월 재조회 중에는 이전 응답의 수치나 기준월을 새 결과처럼 표시하지 않는다', () => {
    const report = buildFinancialReport(input([statement(8)], { perception: perception(), perceptionLoading: true }));
    expect(metric(report, 'construction').status).toBe('산출 중');
    expect(metric(report, 'construction').value).toBe('—');
    expect(metric(report, 'construction').points).toEqual([]);
    expect(metric(report, 'construction').basis).not.toContain('2026/06');
  });

  it('응답 미수신·조회 실패·필수 값 누락을 구분한다', () => {
    const pending = buildFinancialReport(input([statement(8)]));
    expect(metric(pending, 'construction').status).toBe('산출 중');
    expect(metric(pending, 'funding').status).toBe('산출 중');
    const missing: PerceptionResponse = perception();
    if (!missing.ok) throw new Error('합성 결과는 성공 응답');
    const unavailable: PerceptionResponse = {
      ok: true, value: { ...missing.value, result: { kind: 'unavailable', month: ym('2026/06'), missing: [{ key: '주가', reason: '아직 공표 전' }] } },
    };
    const report = buildFinancialReport(input([statement(8)], { perception: unavailable, funding: { ok: false, reason: '합성 조회 실패' } }));
    expect(metric(report, 'construction').status).toBe('산출 불가');
    expect(metric(report, 'construction').narrative).toContain('주가: 아직 공표 전');
    expect(metric(report, 'construction').points).toEqual([{ month: '2026/06', value: null }]);
    expect(metric(report, 'funding').narrative).toBe('합성 조회 실패');
  });

  it('다른 최신 회차의 외부 응답을 받아도 새 회차의 결과로 재사용하지 않는다', () => {
    const report = buildFinancialReport(input([statement(9)], { perception: perception(), funding: funding() }));
    for (const id of ['construction', 'funding'] as const) {
      expect(metric(report, id).status).toBe('산출 중');
      expect(metric(report, id).value).toBe('—');
      expect(metric(report, id).points).toEqual([]);
    }
  });

  it('금리 응답의 산출불가 사유와 실제 관측월을 보존한다', () => {
    const response: FundingRiskResponse = {
      ok: true,
      value: { source: '회차', fetchedAt: null, result: { kind: 'unavailable', judgedMonth: ym('2026/08'), observedMonth: ym('2026/07'), reason: '마지막 평가일 3사 평균이 비어 있습니다.' } },
    };
    const result = metric(buildFinancialReport(input([statement(8)], { funding: response })), 'funding');
    expect(result.status).toBe('산출 불가');
    expect(result.value).toBe('—');
    expect(result.narrative).toBe('마지막 평가일 3사 평균이 비어 있습니다.');
    expect(result.points).toEqual([{ month: '2026/07', value: null }]);
  });

  it('긴 건설경기 누락 사유와 시재 진단은 보고서에서 집계해 요약한다', () => {
    const response = perception();
    if (!response.ok) throw new Error('합성 결과는 성공 응답');
    const report = buildFinancialReport(input([statement(8, { 기초시재: flat(9_000) })], {
      perception: { ok: true, value: { ...response.value, result: {
        kind: 'unavailable', month: ym('2026/06'), missing: [
          { key: '주가', reason: '합성 첫째 사유' }, { key: '환율', reason: '합성 둘째 사유' },
          { key: '총수주액', reason: '합성 셋째 사유' },
        ],
      } } },
    }));
    expect(metric(report, 'construction').narrative).toContain('이외 1개 지표');
    expect(metric(report, 'construction').narrative).not.toContain('합성 셋째 사유');
    expect(report.warnings).toContain('시재 이월 불일치 13건: 대시보드에서 상세 확인하세요.');
    expect(report.warnings).toContain('산출 불가 지표 2개 · 산출 중 지표 1개: 해당 지표의 사유를 확인하세요.');
  });

  it('순유입을 비율 0으로 표시하지 않으며 음수 적정시재·금리 차이는 보존한다', () => {
    const report = buildFinancialReport(input([statement(8, { 수입: flat(1_000) })], { funding: funding(3.003, 3.123) }));
    const gap = metric(report, 'liquidity');
    expect(gap.value).toBe('순유입');
    expect(gap.grade).toBe('정상');
    expect(gap.points.at(-1)?.value).toBeNull();
    expect(gap.narrative).toContain('Gap 비율을 산출하지 않습니다');
    const cash = metric(report, 'cash');
    expect(cash.value).toBe('-1,044 억원');
    expect(cash.points.at(-1)?.secondary).toBe(-1_044);
    expect(cash.status).toBe('안정적');
    expect(metric(report, 'funding').value).toBe('−0.120%p');
    expect(metric(report, 'funding').points[0].value).toBe(-0.12);
  });
});
