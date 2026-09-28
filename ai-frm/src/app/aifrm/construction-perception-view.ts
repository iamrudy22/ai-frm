/**
 * 건설경기 인식 지수 카드의 표시 — 라우트 결과를 표 행과 문장으로 바꾼다.
 *
 * 계산은 하지 않는다. 도메인이 낸 값의 모양만 정한다. 컴포넌트에서 떼어 두어
 * 표기 규칙(대출금리는 bp, 분양회수는 원값 없음 등)을 테스트한다.
 */

import type { PerceptionReportDto } from '@/app/api/construction-perception/dto';
import {
  baseMonthOfRound,
  type ConstructionPerception,
} from '@/domain/risk/construction-perception/construction-perception';
import { PLAN_ROUND_LAG, roundsNeededFor } from '@/domain/risk/construction-perception/forecast-error';
import {
  REPORT_LAG_MONTHS,
  ROUND_LAG_MONTHS,
  SCORING_RULES,
  type IndicatorKey,
} from '@/domain/risk/construction-perception/policy';
import { addMonths, compareYearMonth, type YearMonth } from '@/domain/shared/year-month';

/** 화면 표기. 코드 식별자와 띄어쓰기가 다른 것만 적는다. */
const LABEL: Partial<Record<IndicatorKey, string>> = {
  분양회수예측오차: '분양회수 예측오차',
  선행지수순환변동치: '선행지수 순환변동치',
};

export const indicatorLabel = (key: IndicatorKey): string => LABEL[key] ?? key;

const MINUS = '−';

function signed(value: number, digits: number, suffix: string): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return `${(0).toFixed(digits)}${suffix}`;
  return `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded).toFixed(digits)}${suffix}`;
}

/** 변화율. 대출금리만 %p 차이 × 100(bp)이고 나머지는 비율이다. */
export function changeText(key: IndicatorKey, change: number): string {
  return key === '대출금리' ? signed(change, 1, 'bp') : signed(change * 100, 2, '%');
}

export type IndicatorRow = {
  지표: string;
  원값: string;
  변화율: string;
  점수: string;
  기여도: string;
} & Record<string, unknown>;

export function indicatorRows(report: PerceptionReportDto): IndicatorRow[] {
  const { result, diagnostics } = report;
  if (result.kind !== 'ok') return [];

  const unitOf = new Map(diagnostics.indicators.map((i) => [i.key, i.unit]));

  return SCORING_RULES.map((rule) => {
    const line = result.lines.find((l) => l.key === rule.key);
    if (line === undefined) throw new Error(`${rule.key} 줄이 없습니다.`);
    const unit = unitOf.get(rule.key);
    return {
      지표: indicatorLabel(rule.key),
      원값:
        line.current === undefined
          ? '—'
          : `${line.current.toLocaleString('ko-KR', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`,
      변화율: changeText(rule.key, line.change),
      점수: line.score.toFixed(3),
      기여도: line.contribution.toFixed(2),
    };
  });
}

export type MissingRow = { 지표: string; 사유: string } & Record<string, unknown>;

export function missingRows(result: ConstructionPerception | PerceptionReportDto['result']): MissingRow[] {
  if (result.kind !== 'unavailable') return [];
  return result.missing.map((m) => ({ 지표: indicatorLabel(m.key), 사유: m.reason }));
}

/** 기준월이 어디서 왔는지(정책 §5, 2026-09-28 재개정). */
export function basisNote(basis: PerceptionReportDto['basis']): string {
  const { baseMonth, reportMonth, source } = basis;
  if (source === '회차') return `${reportMonth} 기준(최신 회차) → 기준월 ${baseMonth}`;
  if (source === '오늘') return `보고월 ${reportMonth}(오늘) → 기준월 ${baseMonth}`;
  const chosen = `직접 고른 기준월 ${baseMonth}`;
  if (reportMonth === null) return chosen;
  return `${chosen} · 기본값은 최신 회차 ${reportMonth} − ${ROUND_LAG_MONTHS} = ${baseMonthOfRound(reportMonth)}`;
}

/**
 * 지금의 기본 기준월(오늘 − 2)보다 앞선 달이면, 그동안 수정된 ECOS 값으로
 * 계산된다는 것을 알린다(정책 §5, §6-2).
 */
export function revisionNote(report: PerceptionReportDto): string | null {
  const todayDefault = addMonths(report.selectable.to, 1 - REPORT_LAG_MONTHS);
  if (compareYearMonth(report.basis.baseMonth, todayDefault) >= 0) return null;
  return 'ECOS 현재 값으로 계산합니다. 잠정치 수정이나 기준연도 개편으로 당시 보고한 값과 다를 수 있습니다.';
}

/** 기준월 선택지. 최신 달부터. 지금 기준월이 범위 밖이어도 넣는다. */
export function monthOptions(
  selectable: PerceptionReportDto['selectable'],
  current: YearMonth,
): YearMonth[] {
  const months: YearMonth[] = [];
  if (selectable.from !== null) {
    for (let m = selectable.to; compareYearMonth(m, selectable.from) >= 0; m = addMonths(m, -1)) months.push(m);
  }
  if (!months.includes(current)) months.push(current);
  return months.sort((a, b) => compareYearMonth(b, a));
}

/**
 * 올린 회차 안내(정책 §3-2·§3-3). 기준월 b에는 b−1월 회차(계획)와 b+2월 회차(실적)가
 * 필요하다. 무엇이 있고 무엇을 올려야 하는지 알린다. 회차는 저장하지 않으므로 지금
 * 화면에 올린 것만 센다.
 */
export function ledgerNote(ledger: PerceptionReportDto['diagnostics']['ledger'], baseMonth: YearMonth): string {
  const { plan, actual } = roundsNeededFor(baseMonth);
  const neededText = `기준월 ${baseMonth}에는 ${plan} 회차(계획)와 ${actual} 회차(실적)가 필요합니다`;
  if (ledger.rounds.length === 0) {
    return `분양회수에 쓸 회차를 올리지 않았습니다. ${neededText}.`;
  }

  const range = `${ledger.rounds[0]}~${ledger.latestRound} ${ledger.rounds.length}개`;
  const absent = [plan, actual].filter((r) => !ledger.rounds.includes(r));
  const need =
    absent.length === 0
      ? `기준월 ${baseMonth}에 필요한 ${plan}·${actual} 회차가 모두 있습니다.`
      : `${neededText} — ${absent.join('·')} 회차를 올리세요.`;
  return `분양회수에 쓸 회차: ${range}. ${need}`;
}

export type BatchResult =
  | { readonly file: string; readonly round: YearMonth }
  | { readonly file: string; readonly reason: string };

/** 여러 회차 파일을 읽은 결과. 하나라도 실패하면 경고로 보인다. */
export function readRoundsText(results: readonly BatchResult[]): {
  status: 'success' | 'warning';
  text: string;
} {
  const rounds = results
    .flatMap((r) => ('round' in r ? [r.round] : []))
    .sort(compareYearMonth);
  const failures = results.flatMap((r) => ('reason' in r ? [`${r.file} — ${r.reason}`] : []));

  const done = rounds.length > 0 ? `회차 ${rounds.length}개를 읽었습니다: ${rounds.join('·')}.` : '읽은 회차가 없습니다.';
  if (failures.length === 0) return { status: 'success', text: done };
  return { status: 'warning', text: `${done} 읽지 못한 파일: ${failures.join(' / ')}` };
}

/**
 * 분양회수 예측오차가 어느 창인지. 기준월 b의 지수는 b+2월 회차에 적힌 b−1 ~ b+1월 실적을
 * b−1월 회차 계획과 견준다 — 엑셀 분양회수data b+2 행과 같은 창이다.
 */
export function forecastWindowNote(baseMonth: YearMonth): string {
  const { plan, actual } = roundsNeededFor(baseMonth);
  const lastActual = addMonths(plan, PLAN_ROUND_LAG - 1);
  return `분양회수 예측오차는 원값이 아니라 ${actual} 회차에 적힌 ${plan}~${lastActual} 실적을 ${plan} 회차 계획과 견준 3개월 누적 오차율입니다(엑셀 분양회수data ${actual} 행과 같은 창).`;
}
