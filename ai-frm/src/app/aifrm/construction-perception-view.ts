/**
 * 건설경기 인식 지수 카드의 표시 — 라우트 결과를 표 행과 문장으로 바꾼다.
 *
 * 계산은 하지 않는다. 도메인이 낸 값의 모양만 정한다. 컴포넌트에서 떼어 두어
 * 표기 규칙(대출금리는 bp, 분양회수는 원값 없음 등)을 테스트한다.
 */

import type { PerceptionReportDto } from '@/app/api/construction-perception/dto';
import {
  defaultBaseMonth,
  type ConstructionPerception,
} from '@/domain/risk/construction-perception/construction-perception';
import { REPORT_LAG_MONTHS, SCORING_RULES, type IndicatorKey } from '@/domain/risk/construction-perception/policy';
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

/** 기준월이 어디서 왔는지(정책 §5, 2026-09-28 개정). */
export function basisNote(basis: PerceptionReportDto['basis']): string {
  const { baseMonth, reportMonth, source } = basis;
  if (source === '회차') return `보고월 ${reportMonth}(최신 회차) → 기준월 ${baseMonth}`;
  if (source === '오늘') return `보고월 ${reportMonth}(오늘) → 기준월 ${baseMonth}`;
  const chosen = `직접 고른 기준월 ${baseMonth}`;
  if (reportMonth === null) return chosen;
  return `${chosen} · 기본값은 보고월 ${reportMonth} − ${REPORT_LAG_MONTHS} = ${defaultBaseMonth(reportMonth)}`;
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

export function ledgerNote(ledger: PerceptionReportDto['diagnostics']['ledger']): string {
  if (ledger.latestActualMonth === null) {
    return '분양회수 계획·실적 이력이 비어 있습니다. 최신 회차를 올리세요.';
  }
  const head = `분양회수 계획·실적 이력: ${ledger.latestActualMonth} 실적까지 쌓였`;
  if (ledger.gaps.length === 0) return `${head}습니다.`;
  return `${head}지만 ${ledger.gaps.join(', ')}이(가) 비어 있습니다. 그 달과 다음 달 회차를 올리면 채워집니다.`;
}
