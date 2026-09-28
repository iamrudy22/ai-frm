/**
 * 건설경기 인식 지수 — 경제지표 10종을 하나의 위기 지수로 모은다.
 *
 *   원값 → 변화율 → 점수(0~1) → 종합위기인식지수(Σ 가중치 × 점수) → 종합위기단계
 *
 * 입력은 달력 월로 키가 잡힌 원값 계열이다. ECOS에서 왔는지 엑셀에서 왔는지는
 * 모른다. 분양회수 예측오차는 원값이 아니라 이미 계산된 오차율로 받는다
 * (forecast-error.ts가 분양회수 계획·실적 이력에서 만든다).
 *
 * 결측은 0이 아니다(정책 §6-1). 엑셀은 빈칸을 0으로 읽어 한 칸만 채운 달을
 * "위기"로 판정했다. 여기서는 값이 하나라도 없으면 지수를 내지 않고
 * 산출불가와 빠진 지표를 돌려준다.
 */

import { gradeBy, type Grade } from '@/domain/risk/grade';
import {
  SCORING_RULES,
  STAGE_BANDS,
  perceptionIndex,
  type IndicatorKey,
  type PerceptionIndex,
  type ScoringRule,
} from '@/domain/risk/construction-perception/policy';
import type { Ratio } from '@/domain/shared/amount';
import { addMonths, compareYearMonth, type YearMonth } from '@/domain/shared/year-month';

export type RawSeries = ReadonlyMap<YearMonth, number>;

/** 값이 없다는 사실과 그 사유. 0으로 대신하지 않는다. */
export type Missing = { readonly missing: string };

export function isMissing(value: unknown): value is Missing {
  return typeof value === 'object' && value !== null && 'missing' in value;
}

/** 원값 계열로 받는 9종. 분양회수 예측오차만 오차율로 받는다. */
export type EcosIndicatorKey = Exclude<IndicatorKey, '분양회수예측오차'>;

export type PerceptionInput = {
  readonly series: Readonly<Record<EcosIndicatorKey, RawSeries>>;
  readonly forecastError: (month: YearMonth) => Ratio | Missing;
};

/** 지표별 최신월. `null`은 알 수 없다는 뜻이다(조회 실패 등). */
export type Latest = Readonly<Record<IndicatorKey, YearMonth | null>>;

export type IndicatorLine = {
  readonly key: IndicatorKey;
  /** 당월 원값. 분양회수 예측오차는 원값이 없다. */
  readonly current?: number;
  /** 비교 원값(전월 또는 전년동월). */
  readonly reference?: number;
  /** 변화율. 대출금리는 bp. */
  readonly change: number;
  readonly score: number;
  /** 가중치 × 점수. 지수에 이만큼 기여했다. */
  readonly contribution: number;
};

export type MissingIndicator = { readonly key: IndicatorKey; readonly reason: string };

export type ConstructionPerception =
  | {
      readonly kind: 'ok';
      readonly month: YearMonth;
      readonly index: PerceptionIndex;
      readonly grade: Grade;
      readonly lines: readonly IndicatorLine[];
    }
  | {
      readonly kind: 'unavailable';
      /** 기준월을 정하지 못했으면 null. */
      readonly month: YearMonth | null;
      readonly missing: readonly MissingIndicator[];
    };

/**
 * 점수화 기준 표 한 줄을 해석한다. 엑셀 IF문과 같은 순서로 본다 —
 * 만점 조건, 영점 조건, 그 사이는 선형.
 */
export function scoreBy(rule: ScoringRule, change: number): number {
  const r = rule.direction === '양방향' ? Math.abs(change) : change;
  const falling = rule.direction === '하락';

  if (falling ? r <= rule.full : r >= rule.full) return 1;
  if (falling ? r >= rule.zero : r <= rule.zero) return 0;

  const score = (r - rule.zero) / (rule.full - rule.zero);
  // 영점에서 선형식이 −0을 낼 수 있다. 값은 같지만 표시·비교에서 새지 않게 0으로 둔다.
  return score === 0 ? 0 : score;
}

type Change = { readonly current?: number; readonly reference?: number; readonly change: number };

function changeOf(rule: ScoringRule, input: PerceptionInput, month: YearMonth): Change | Missing {
  if (rule.key === '분양회수예측오차') {
    const error = input.forecastError(month);
    return isMissing(error) ? error : { change: error };
  }

  const series = input.series[rule.key as EcosIndicatorKey];
  const refMonth = addMonths(month, rule.transform === '전년동월비' ? -12 : -1);
  const refName = rule.transform === '전년동월비' ? '전년동월' : '전월';

  const current = series.get(month);
  if (current === undefined || !Number.isFinite(current)) {
    return { missing: `${month} 값이 없습니다.` };
  }
  const reference = series.get(refMonth);
  if (reference === undefined || !Number.isFinite(reference)) {
    return { missing: `${refMonth}(${refName}) 값이 없습니다.` };
  }

  if (rule.transform === '전월차bp') {
    return { current, reference, change: (current - reference) * 100 };
  }
  if (reference === 0) {
    return { missing: `${refMonth}(${refName}) 값이 0이라 변화율을 낼 수 없습니다.` };
  }
  return { current, reference, change: (current - reference) / reference };
}

/** 한 달을 산출한다. 값이 하나라도 없으면 산출불가다. */
export function assessConstructionPerception(input: PerceptionInput, month: YearMonth): ConstructionPerception {
  const lines: IndicatorLine[] = [];
  const missing: MissingIndicator[] = [];

  for (const rule of SCORING_RULES) {
    const c = changeOf(rule, input, month);
    if (isMissing(c)) {
      missing.push({ key: rule.key, reason: c.missing });
      continue;
    }
    const score = scoreBy(rule, c.change);
    lines.push({ key: rule.key, ...c, score, contribution: rule.weight * score });
  }

  if (missing.length > 0) {
    return { kind: 'unavailable', month, missing };
  }

  // 엑셀 SUMPRODUCT와 같은 순서(1번 → 10번)로 더한다.
  const index = perceptionIndex(lines.reduce((sum, l) => sum + l.contribution, 0));
  return { kind: 'ok', month, index, grade: gradeBy(STAGE_BANDS, index), lines };
}

/**
 * 기준월 = 지표별 최신월 중 가장 이른 달(정책 §5).
 *
 * 공표 시차가 지표마다 달라서 가장 늦게 나오는 지표가 기준월을 정한다.
 * 최신월을 알 수 없는 지표가 있으면 기준월을 정하지 않는다.
 */
export function baseMonthOf(latest: Latest): YearMonth | { readonly unknown: IndicatorKey[] } {
  const unknown = SCORING_RULES.map((r) => r.key).filter((key) => latest[key] === null);
  if (unknown.length > 0) return { unknown };

  return SCORING_RULES.map((r) => latest[r.key] as YearMonth).reduce((a, b) =>
    compareYearMonth(a, b) <= 0 ? a : b,
  );
}

/**
 * 기준월을 정해 그 달 하나를 산출한다.
 *
 * 기준월에 빈 값이 있어도 이전 달로 **거슬러 내려가지 않는다.** 내려가서 처음
 * 산출되는 달을 보여 주면 직전 확정월을 조용히 보여 주는 것과 같다. 그 방식은
 * 쓰지 않기로 했다(정책 §9-1 Q2). 대신 산출불가와 빠진 지표를 알린다.
 */
export function assessLatest(input: PerceptionInput, latest: Latest): ConstructionPerception {
  const base = baseMonthOf(latest);
  if (typeof base !== 'string') {
    return {
      kind: 'unavailable',
      month: null,
      missing: base.unknown.map((key) => ({ key, reason: '최신월을 알 수 없어 기준월을 정할 수 없습니다.' })),
    };
  }
  return assessConstructionPerception(input, base);
}
