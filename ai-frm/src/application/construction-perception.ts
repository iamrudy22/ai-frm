/**
 * 유스케이스: 건설경기 인식 지수 산출 — ECOS 9종과 분양회수 이력으로 기준월
 * 한 달을 산출한다.
 *
 *   ECOS 9종 조회 → 이력 불러오기 → 지표별 최신월 → 기준월 → 그 달 산출
 *
 * 실패는 두 층이다.
 *   - ECOS 실패는 지표 단위다. 그 지표의 최신월을 알 수 없게 되어 산출불가로
 *     나온다. 조회 전체가 실패해도 9종이 모두 조회 실패일 뿐 던지지 않는다.
 *   - 이력 저장소 실패(파일 손상 등)는 산출 자체를 할 수 없으므로 Outcome 실패다.
 */

import { settleAsync, succeed, type Outcome } from '@/application/outcome';
import type { EconomicIndicatorSource, ForecastLedgerRepository, IndicatorFetch, SourceResult } from '@/application/ports';
import {
  assessLatest,
  type ConstructionPerception,
  type EcosIndicatorKey,
  type Latest,
  type RawSeries,
} from '@/domain/risk/construction-perception/construction-perception';
import { forecastErrorAt } from '@/domain/risk/construction-perception/forecast-error';
import { SCORING_RULES, type IndicatorKey } from '@/domain/risk/construction-perception/policy';
import { compareYearMonth, type YearMonth } from '@/domain/shared/year-month';

export type IndicatorStatus = {
  readonly key: IndicatorKey;
  readonly latest: YearMonth | null;
  /** ECOS 응답의 단위 그대로. 기준연도 개편이 있으면 바뀐다. */
  readonly unit?: string;
  readonly error?: string;
};

export type PerceptionDiagnostics = {
  /** 엑셀 열 순서(1~10번). */
  readonly indicators: readonly IndicatorStatus[];
  readonly ledger: { readonly latestActualMonth: YearMonth | null; readonly gaps: readonly YearMonth[] };
  readonly fetchedAt: Date;
};

export type PerceptionReport = {
  readonly result: ConstructionPerception;
  /** 지표별 최신월·단위·조회 실패, 이력 상태. 기준월이 왜 그 달인지 화면이 설명할 때 쓴다. */
  readonly diagnostics: PerceptionDiagnostics;
};

const ECOS_KEYS = SCORING_RULES.map((r) => r.key).filter(
  (k): k is EcosIndicatorKey => k !== '분양회수예측오차',
);

export async function assessPerception(
  source: EconomicIndicatorSource,
  repo: ForecastLedgerRepository,
  now: () => Date = () => new Date(),
): Promise<Outcome<PerceptionReport>> {
  return settleAsync(async () => {
    const fetched = await fetchSafely(source);
    const ledger = await repo.load();
    const fetchedAt = now();

    const series = {} as Record<EcosIndicatorKey, RawSeries>;
    const statuses = new Map<IndicatorKey, IndicatorStatus>();
    const whyUnknown = new Map<IndicatorKey, string>();

    for (const key of ECOS_KEYS) {
      const f = fetched[key];
      if ('error' in f) {
        series[key] = new Map();
        statuses.set(key, { key, latest: null, error: f.error });
        whyUnknown.set(key, `ECOS 조회 실패: ${f.error}`);
        continue;
      }
      series[key] = f.values;
      const latest = lastMonthOf(f.values);
      statuses.set(key, { key, latest, unit: f.unit });
      if (latest === null) whyUnknown.set(key, 'ECOS에 이 지표의 값이 하나도 없습니다.');
    }

    const ledgerLatest = ledger.latestActualMonth();
    statuses.set('분양회수예측오차', { key: '분양회수예측오차', latest: ledgerLatest });
    if (ledgerLatest === null) {
      whyUnknown.set('분양회수예측오차', '분양회수 계획·실적 이력이 비어 있습니다. 최신 회차를 올리세요.');
    }

    const latest = Object.fromEntries([...statuses].map(([k, s]) => [k, s.latest])) as Latest;
    const result = assessLatest({ series, forecastError: (t) => forecastErrorAt(ledger, t) }, latest);

    return succeed({
      result: explainUnknown(result, whyUnknown),
      diagnostics: {
        indicators: SCORING_RULES.map((r) => statuses.get(r.key) as IndicatorStatus),
        ledger: { latestActualMonth: ledgerLatest, gaps: [...ledger.gaps()] },
        fetchedAt,
      },
    });
  }, '건설경기 인식 지수를 산출하지 못했습니다.');
}

/** 조회 전체가 던져도 9종 모두 조회 실패로 바꿔 이어 간다. */
async function fetchSafely(source: EconomicIndicatorSource): Promise<SourceResult> {
  try {
    return await source.fetchAll();
  } catch (e) {
    const error: IndicatorFetch = { error: e instanceof Error ? e.message : 'ECOS 조회에 실패했습니다.' };
    return Object.fromEntries(ECOS_KEYS.map((k) => [k, error])) as SourceResult;
  }
}

function lastMonthOf(values: RawSeries): YearMonth | null {
  let last: YearMonth | null = null;
  for (const m of values.keys()) {
    if (last === null || compareYearMonth(m, last) > 0) last = m;
  }
  return last;
}

/** 기준월을 정하지 못한 산출불가에, 최신월을 모르는 진짜 이유를 적는다. */
function explainUnknown(
  result: ConstructionPerception,
  why: ReadonlyMap<IndicatorKey, string>,
): ConstructionPerception {
  if (result.kind !== 'unavailable' || result.month !== null) return result;
  return {
    ...result,
    missing: result.missing.map((m) => ({ key: m.key, reason: why.get(m.key) ?? m.reason })),
  };
}
