/** 보고서 표시 모델. 산식과 판정은 기존 도메인을 쓰고, 보고서의 월·단위·문장만 조립한다. */

import type { PerceptionResponse } from '@/app/api/construction-perception/dto';
import type { FundingRiskResponse } from '@/app/api/funding-risk/dto';
import { assessDashboard, type Dashboard } from '@/application/dashboard';
import { calendarOf } from '@/domain/cashflow/statement';
import { LCR_WEIGHTS, verdictLabel } from '@/domain/risk/adequate-cash/policy';
import { baseMonthOfRound } from '@/domain/risk/construction-perception/construction-perception';
import type { IndicatorLine } from '@/domain/risk/construction-perception/construction-perception';
import { SCORING_RULES } from '@/domain/risk/construction-perception/policy';
import type { Grade } from '@/domain/risk/grade';
import { addMonths, compareYearMonth, parseYearMonth, type YearMonth } from '@/domain/shared/year-month';
import { spanText } from './dashboard-view';
import { money, percentPoints } from './format';
import type { UploadedRound } from './uploaded-rounds';
import { summarizeHistory, type ChartDatum, type HistoryCoverage } from './report-chart-view';
import { buildStatementReferenceTrends, type StatementReferenceTrends } from './report-reference';

export type ReportPoint = ChartDatum & { secondary?: number | null };

export type ReportMetric = {
  id: 'recovery' | 'liquidity' | 'construction' | 'funding' | 'cash';
  title: string;
  value: string;
  status: string;
  grade: Grade | null;
  basis: string;
  narrative: string;
  formula: string;
  source: string;
  points: readonly ReportPoint[];
  historyNote: string;
  historyCoverage: HistoryCoverage;
};

export type FinancialReport = {
  title: string;
  reportMonth: string;
  latestRound: string;
  generatedOn: string;
  isTemplate: boolean;
  metrics: readonly ReportMetric[];
  warnings: readonly string[];
  referenceTrends: StatementReferenceTrends | null;
};

export type FinancialReportInput = {
  rounds: readonly UploadedRound[];
  dashboard: Dashboard;
  gapMonth: YearMonth;
  perception: PerceptionResponse | null;
  perceptionLoading?: boolean;
  funding: FundingRiskResponse | null;
  generatedAt?: Date;
};

const NONE = '—';
const LOCAL_HISTORY = '회차별 당시 계획 기준 · 최대 18개월 · 누락월은 연결하지 않음.';
const EXTERNAL_HISTORY = '과거 산출 이력 미조회. 현재 응답의 기준월 한 점만 표시합니다.';

const DEFINITIONS: ReadonlyArray<Pick<ReportMetric, 'id' | 'title' | 'formula' | 'source'>> = [
  { id: 'recovery', title: '대금 회수 위험', formula: '분양회수 실적 ÷ 분양회수 계획', source: '자금수지표의 연속한 두 회차 · 분양회수' },
  { id: 'liquidity', title: '유동성 Gap', formula: '기초시재 ÷ (향후 3개월 지출 − 수입)', source: '최신 자금수지표 · 기초시재·수입·지출' },
  { id: 'construction', title: '건설경기 인식 지수', formula: 'Σ(세부지표 점수 × 가중치)', source: '한국은행 ECOS 9종 · 자금수지표 분양회수 예측오차' },
  { id: 'funding', title: '조달위험 인식 지수', formula: '공사채 AAA 1년 금리 − 국고채 1년 금리 (각 3사 평균)', source: '금융투자협회 채권정보센터 · 관측월 마지막 평가일' },
  { id: 'cash', title: '적정 시재', formula: `${LCR_WEIGHTS.분양회수} × 분양회수 + ${LCR_WEIGHTS.기타수입} × 기타수입 + ${LCR_WEIGHTS.지출} × 지출 + ${LCR_WEIGHTS.수지차} × (지출 − 수입) (각 3개월 합계)`, source: '최신 자금수지표 · LCR 모델' },
];

function metric(id: ReportMetric['id'], basis: string, points: readonly ReportPoint[] = []): ReportMetric {
  const definition = DEFINITIONS.find((item) => item.id === id)!;
  return {
    ...definition,
    value: NONE,
    status: '산출 전',
    grade: null,
    basis,
    narrative: '자금수지표를 업로드하고 지표를 산출하면 결과가 표시됩니다.',
    points,
    historyCoverage: summarizeHistory(points),
    historyNote: id === 'construction' || id === 'funding' ? EXTERNAL_HISTORY : LOCAL_HISTORY,
  };
}

/** 서버·브라우저가 어느 시간대에서 실행되든 한국 날짜로 작성일을 정한다. */
function koreanDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}.${part('month')}.${part('day')}`;
}

/** 금액 값은 억원, 긴 설명에서는 큰 금액을 조원으로 읽는다. 반올림은 표시 단계에서만 한다. */
function narrativeMoney(value: number): string {
  return Math.abs(value) >= 10_000
    ? `${(value / 10_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}조원`
    : money(value);
}

function missingPoint(month: YearMonth, reason: string): ReportPoint {
  return { month, kind: 'missing', value: null, reason };
}

function availablePoint(month: YearMonth, value: number): ReportPoint {
  return Number.isFinite(value)
    ? { month, kind: 'available', value }
    : missingPoint(month, '산출값이 유한한 수가 아닙니다.');
}

const CASH_COMPARISON_MISSING = '현재시재와 적정시재가 모두 유한한 수여야 비교할 수 있습니다.';

/** 현재시재·적정시재는 한 쌍으로 비교한다. 0과 음수도 유효하다. */
function cashPoint(month: YearMonth, openingCash: number, adequateCash: number): ReportPoint {
  return Number.isFinite(openingCash) && Number.isFinite(adequateCash)
    ? { month, kind: 'available', value: openingCash, secondary: adequateCash }
    : { ...missingPoint(month, CASH_COMPARISON_MISSING), secondary: null };
}

/** 빠진 달에는 회차 부재 사유를 남긴다. 결측과 산출값 0은 서로 다르다. */
function continuousPoints(points: readonly ReportPoint[]): ReportPoint[] {
  const byMonth = new Map(points.map((point) => [point.month, point]));
  const months = [...byMonth.keys()].map(parseYearMonth).sort(compareYearMonth);
  if (months.length === 0) return [];
  const to = months[months.length - 1];
  const limit = addMonths(to, -17);
  const from = compareYearMonth(months[0], limit) < 0 ? limit : months[0];
  const hasSecondary = points.some((point) => point.secondary !== undefined);
  const result: ReportPoint[] = [];
  for (let month = from; compareYearMonth(month, to) <= 0; month = addMonths(month, 1)) {
    result.push(byMonth.get(month) ?? { ...missingPoint(month, '업로드 회차가 없습니다.'), ...(hasSecondary ? { secondary: null } : {}) });
  }
  return result;
}

type LocalHistory = Record<'recovery' | 'liquidity' | 'cash', readonly ReportPoint[]>;

function localHistory(rounds: readonly UploadedRound[], latest: UploadedRound, input: FinancialReportInput): LocalHistory {
  const history: Record<keyof LocalHistory, ReportPoint[]> = { recovery: [], liquidity: [], cash: [] };
  for (const current of rounds) {
    const previous = rounds.find((r) => r.round === addMonths(current.round, -1));
    // 본문에서 다른 달을 골라도 아카이브는 각 회차의 원래 기준월에 고정한다.
    // 선택 결과를 그 달의 이력으로 넣으면 이전 회차의 당시 계획을 수정값으로 덮게 된다.
    const reuseCurrent = current === latest && input.gapMonth === latest.round;
    const dashboard = reuseCurrent
      ? input.dashboard
      : assessDashboard(previous?.statement ?? null, current.statement, current.statement.defaultBaseMonth);
    const base = calendarOf(current.statement, current.statement.defaultBaseMonth);
    const recovery = previous === undefined ? null : dashboard.paymentRecovery;
    const gap = dashboard.liquidityGap;
    const cash = dashboard.adequateCash;
    const cashMonth = cash.ok ? calendarOf(current.statement, cash.value.month) : base;
    const recoveryMonth = addMonths(current.round, -1);
    history.recovery.push(recovery?.ok
      ? availablePoint(recoveryMonth, recovery.value.rate)
      : missingPoint(recoveryMonth, recovery === null
        ? '직전 회차가 없어 비교할 수 없습니다. 연속한 두 회차가 필요합니다.'
        : recovery.reason));
    history.liquidity.push(!gap.ok
      ? missingPoint(base, gap.reason)
      : gap.value.kind === 'gap'
        ? availablePoint(base, gap.value.gapRatio)
        : { month: base, kind: 'not-applicable', value: null,
          reason: `${gap.value.netInflow === 0 ? '수지 균형' : '순유입'}으로 순지출이 없어 Gap 비율을 산출하지 않습니다.` });
    history.cash.push(cash.ok
      ? cashPoint(cashMonth, cash.value.openingCash, cash.value.adequateCash)
      : { ...missingPoint(cashMonth, cash.reason), secondary: null });
  }
  return {
    recovery: continuousPoints(history.recovery),
    liquidity: continuousPoints(history.liquidity),
    cash: continuousPoints(history.cash),
  };
}

function unavailable(base: ReportMetric, reason: string, status = '산출 불가'): ReportMetric {
  return { ...base, status, narrative: reason };
}

function selectedHistoryNote(input: FinancialReportInput, latest: UploadedRound): string {
  return input.gapMonth === latest.round
    ? LOCAL_HISTORY
    : `${LOCAL_HISTORY} 추이는 회차 기준월의 당시 계획이며, 본문 선택 기준월과 다릅니다.`;
}

function recoveryMetric(input: FinancialReportInput, latest: UploadedRound, history: LocalHistory): ReportMetric {
  const target = addMonths(latest.round, -1);
  const base = metric('recovery', `${target} 실적 · ${target} 회차 계획 / ${latest.round} 회차 실적`, history.recovery);
  const previous = input.rounds.find((r) => r.round === target);
  const outcome = previous === undefined ? null : input.dashboard.paymentRecovery;
  if (outcome === null) return unavailable(base, `${target} 회차가 없어 계획 대비 실적을 비교할 수 없습니다. 연속한 두 회차가 필요합니다.`);
  if (!outcome.ok) return unavailable(base, outcome.reason);
  const result = outcome.value;
  return {
    ...base,
    value: result.rate.toFixed(2), status: result.grade, grade: result.grade,
    narrative: `${target} 분양회수 계획 대비 달성률은 ${(result.rate * 100).toFixed(1)}%(계획 ${narrativeMoney(result.plan)}, 실적 ${narrativeMoney(result.actual)})로, 대금 회수 위험은 '${result.grade}' 단계입니다.`,
  };
}

function liquidityMetric(input: FinancialReportInput, latest: UploadedRound, history: LocalHistory): ReportMetric {
  const base = {
    ...metric('liquidity', `${spanText(input.gapMonth, 3)} (3개월) · ${latest.round} 회차`, history.liquidity),
    historyNote: selectedHistoryNote(input, latest),
  };
  const outcome = input.dashboard.liquidityGap;
  if (!outcome.ok) return unavailable(base, outcome.reason);
  const result = outcome.value;
  if (result.kind === 'net-inflow') {
    return {
      ...base, value: result.netInflow === 0 ? '수지 균형' : '순유입', status: result.grade, grade: result.grade,
      narrative: `향후 3개월 수입 ${narrativeMoney(result.income)}, 지출 ${narrativeMoney(result.expense)}으로 ${result.netInflow === 0 ? '수지가 균형입니다' : `${narrativeMoney(result.netInflow)} 순유입입니다`}. 순지출이 없어 Gap 비율을 산출하지 않습니다.`,
      historyNote: `${base.historyNote} 순유입·수지 균형 월은 비율이 없어 빈 점으로 표시합니다.`,
    };
  }
  return {
    ...base, value: result.gapRatio.toFixed(2), status: result.grade, grade: result.grade,
    narrative: `향후 3개월 순지출은 ${narrativeMoney(result.netOutflow)}이며, 기초시재 ${narrativeMoney(result.openingCash)}의 Gap 비율은 ${result.gapRatio.toFixed(2)}입니다. 정책 구간에 따른 판정은 '${result.grade}'입니다.`,
  };
}

function cashMetric(input: FinancialReportInput, latest: UploadedRound, history: LocalHistory): ReportMetric {
  const outcome = input.dashboard.adequateCash;
  const first = outcome.ok ? calendarOf(latest.statement, outcome.value.month) : input.gapMonth;
  const base = {
    ...metric('cash', `${spanText(first, 3)} (3개월) · ${latest.round} 회차`, history.cash),
    historyNote: selectedHistoryNote(input, latest),
  };
  if (!outcome.ok) return unavailable(base, outcome.reason);
  const result = outcome.value;
  if (!Number.isFinite(result.openingCash) || !Number.isFinite(result.adequateCash)) return unavailable(base, CASH_COMPARISON_MISSING);
  const difference = result.surplus === 0 ? '두 금액이 같습니다' : `${narrativeMoney(Math.abs(result.surplus))} ${result.surplus > 0 ? '여유가 있습니다' : '부족합니다'}`;
  return {
    ...base, value: money(result.adequateCash), status: verdictLabel(result.isAdequate),
    narrative: `현재 시재 ${narrativeMoney(result.openingCash)}, 향후 3개월 적정 시재 ${narrativeMoney(result.adequateCash)}으로 ${difference}. 판정은 ${result.isAdequate ? 'T(안정적)' : 'F(적정시재 부족)'}입니다.${result.isPlan ? ' 현재 시재는 선택한 달의 계획 이월 잔고입니다.' : ''}${result.beyondPlanYear ? ' 관측 구간에 다음 해의 미확정 계획이 포함됩니다.' : ''}`,
  };
}

/** 기준 보고서의 세 가지 설명 지표. 관측된 변화율만 서술하고 전망은 덧붙이지 않는다. */
function constructionChanges(lines: readonly IndicatorLine[]): string {
  return ['주택건설인허가실적', '총수주액', '설비투자지수'].flatMap((key) => {
    const line = lines.find((item) => item.key === key);
    const rule = SCORING_RULES.find((item) => item.key === key);
    if (line === undefined || rule === undefined || !Number.isFinite(line.change)) return [];
    const comparison = rule.transform === '전년동월비' ? '전년 동월 대비' : '전월 대비';
    return [`${key}${key === '설비투자지수' ? '는' : '은'} ${comparison} ${Math.abs(line.change * 100).toFixed(2)}% ${line.change > 0 ? '증가' : line.change < 0 ? '감소' : '변동 없음'}`];
  }).join(', ');
}

function constructionMetric(input: FinancialReportInput, latest: UploadedRound): ReportMetric {
  const response = input.perception;
  const base = metric('construction', `기준월 ${baseMonthOfRound(latest.round)} (기본값) · ${latest.round} 회차`);
  if (input.perceptionLoading) {
    return unavailable({ ...base, basis: `새 기준월 응답 대기 · ${latest.round} 회차` }, '건설경기 원자료를 불러오는 중입니다. 이전 응답의 수치는 표시하지 않습니다.', '산출 중');
  }
  if (response === null) return unavailable(base, '건설경기 원자료 응답을 아직 받지 못했습니다.', '산출 중');
  if (!response.ok) return unavailable(base, response.reason);
  const report = response.value;
  if (report.basis.reportMonth !== null && report.basis.reportMonth !== latest.round) {
    return unavailable(base, `${latest.round} 회차의 건설경기 응답을 기다리고 있습니다.`, '산출 중');
  }
  const result = report.result;
  const basisSource = report.basis.source === '선택' ? '직접 선택' : report.basis.source === '오늘' ? '오늘 기준' : `${latest.round} 회차 기준`;
  const withBasis = { ...base, basis: `기준월 ${result.month} · ${basisSource}` };
  if (result.kind === 'unavailable') {
    const reasons = result.missing.slice(0, 2).map((m) => `${m.key}: ${m.reason}`).join(' / ');
    const rest = result.missing.length > 2 ? ` / 이외 ${result.missing.length - 2}개 지표는 대시보드에서 상세 확인하세요.` : '';
    return unavailable({ ...withBasis, points: [missingPoint(result.month, result.missing.map((item) => `${item.key}: ${item.reason}`).join(' / ') || '필요한 세부지표가 없어 산출하지 못했습니다.')] }, `${reasons}${rest}` || '필요한 세부지표가 없어 산출하지 못했습니다.');
  }
  const changes = constructionChanges(result.lines);
  return {
    ...withBasis, value: result.index.toFixed(2), status: result.grade, grade: result.grade,
    narrative: `${result.month} 기준 건설경기 인식 지수는 ${result.index.toFixed(2)}로 '${result.grade}' 단계입니다.${changes ? ` ${changes}입니다.` : ''}`,
    points: [availablePoint(result.month, result.index)],
  };
}

function fundingMetric(input: FinancialReportInput, latest: UploadedRound): ReportMetric {
  const response = input.funding;
  const base = metric('funding', `판단월 ${latest.round} · ${addMonths(latest.round, -1)} 말 금리`);
  if (response === null) return unavailable(base, '채권정보센터 금리 응답을 아직 받지 못했습니다.', '산출 중');
  if (!response.ok) return unavailable(base, response.reason);
  const result = response.value.result;
  if (result.judgedMonth !== latest.round) return unavailable(base, `${latest.round} 판단월의 금리 응답을 기다리고 있습니다.`, '산출 중');
  const withBasis = { ...base, basis: `판단월 ${result.judgedMonth} · ${result.observedMonth} 말 금리` };
  if (result.kind === 'unavailable') return unavailable({ ...withBasis, points: [missingPoint(result.observedMonth, result.reason)] }, result.reason);
  return {
    ...withBasis, value: percentPoints(result.spread), status: result.grade, grade: result.grade,
    narrative: `${result.evaluationDate} 평가일의 공사채 AAA 1년 금리는 ${result.publicAaa.average.toFixed(3)}%, 국고채 1년 금리는 ${result.treasury.average.toFixed(3)}%이며, 금리 차이는 ${percentPoints(result.spread)}입니다. 정책 구간에 따른 판정은 '${result.grade}'입니다.`,
    points: [availablePoint(result.observedMonth, result.spread)],
  };
}

/** 최종 점으로 coverage를 정하되 현재 지표의 로딩·실패·정상 판정은 유지한다. */
function withHistoryCoverage(metric: ReportMetric): ReportMetric {
  const coverage = summarizeHistory(metric.points);
  const count = coverage.availableMonths.length;
  const availability = count === 1
    ? `${coverage.availableMonths[0]}의 1개월 값 확보`
    : count > 1 ? `산출값 ${count}개월 확보` : '';
  const notApplicable = coverage.notApplicableMonths.length > 0
    ? `비율 비적용 ${coverage.notApplicableMonths.length}개월` : '';
  const missing = coverage.missingMonths.length > 0 ? `결측 ${coverage.missingMonths.length}개월` : '';
  const reasons = [...new Set(metric.points.flatMap((point) => point.kind === 'available' ? [] : [point.reason]))];
  // 외부 지표의 긴 원천 사유는 점에 온전히 남기고, 인쇄 캡션은 기존 본문 요약을 쓴다.
  const displayedReasons = metric.id === 'construction' || metric.id === 'funding' ? [] : reasons.slice(0, 2);
  const additionalReasons = displayedReasons.length > 0 && reasons.length > displayedReasons.length
    ? `이외 ${reasons.length - displayedReasons.length}개 사유` : '';
  const current = metric.status === '산출 중' || metric.status === '산출 불가'
    ? `${metric.status}: ${metric.narrative}` : '';
  return {
    ...metric, historyCoverage: coverage,
    historyNote: [metric.historyNote, availability, notApplicable, missing, ...displayedReasons, additionalReasons, current].filter(Boolean).join(' · '),
  };
}

export function buildFinancialReport(input?: FinancialReportInput): FinancialReport {
  const date = koreanDate(input?.generatedAt ?? new Date());
  const rounds = [...(input?.rounds ?? [])].sort((a, b) => compareYearMonth(a.round, b.round));
  const latest = rounds.at(-1);
  if (input === undefined || latest === undefined) {
    return {
      title: '재무위험관리시스템 현황 보고 (양식)', reportMonth: NONE, latestRound: NONE, generatedOn: date, isTemplate: true,
      metrics: DEFINITIONS.map((definition) => metric(definition.id, '자료 업로드 전')),
      warnings: ['빈 보고서 양식입니다. 업로드·산출 전에는 수치를 표시하지 않습니다.'],
      referenceTrends: null,
    };
  }
  const history = localHistory(rounds, latest, input);
  const metrics = [
    recoveryMetric(input, latest, history), liquidityMetric(input, latest, history),
    constructionMetric(input, latest), fundingMetric(input, latest), cashMetric(input, latest, history),
  ].map(withHistoryCoverage);
  const diagnostics = input.dashboard.diagnostics;
  const unavailableCount = metrics.filter((item) => item.status === '산출 불가').length;
  const loadingCount = metrics.filter((item) => item.status === '산출 중').length;
  const warnings: string[] = [];
  if (diagnostics.rollForward.length > 0) {
    const label = diagnostics.rollForward.some((issue) => issue.includes('확인할 수 없습니다')) ? '시재 이월 검증 미완료' : '시재 이월 불일치';
    warnings.push(`${label} ${diagnostics.rollForward.length}건: 대시보드에서 상세 확인하세요.`);
  }
  if (diagnostics.unreadable.length > 0) {
    warnings.push(`읽지 못한 항목 ${diagnostics.unreadable.length}개 (${diagnostics.unreadable.map(({ item }) => item).join('·')}): 대시보드에서 상세 확인하세요.`);
  }
  if (unavailableCount > 0 || loadingCount > 0) {
    warnings.push(`산출 불가 지표 ${unavailableCount}개 · 산출 중 지표 ${loadingCount}개: 해당 지표의 사유를 확인하세요.`);
  }
  const reportMonth = addMonths(latest.round, -1);
  return {
    title: `재무위험관리시스템 현황 보고 (${reportMonth})`, reportMonth, latestRound: latest.round,
    generatedOn: date, isTemplate: false, metrics, warnings: [...new Set(warnings)],
    referenceTrends: buildStatementReferenceTrends(latest),
  };
}
