/**
 * 유스케이스: 건설경기 인식 지수 산출 — ECOS 9종과 분양회수 이력으로 기준월
 * 한 달을 산출한다.
 *
 *   기준월 결정 → ECOS 9종 조회 → 이력 불러오기 → 그 달 산출 → 결측 사유 다듬기
 *
 * 기준월(정책 §5, 2026-09-28 개정): 사용자가 고른 달 > 최신 회차 기준월 − 2 >
 * 오늘이 속한 달 − 2. 정해진 달 하나만 산출하고 거슬러 내려가지 않는다.
 *
 * 실패는 두 층이다.
 *   - ECOS 실패는 지표 단위다. 그 지표가 산출불가 사유로 나온다. 조회 전체가
 *     실패해도 9종이 모두 조회 실패일 뿐 던지지 않는다.
 *   - 이력 저장소 실패(파일 손상 등)는 산출 자체를 할 수 없으므로 Outcome 실패다.
 */

import { settleAsync, succeed, type Outcome } from '@/application/outcome';
import type { EconomicIndicatorSource, ForecastLedgerRepository, IndicatorFetch, SourceResult } from '@/application/ports';
import type { ForecastLedger } from '@/domain/cashflow/forecast-ledger';
import {
  assessConstructionPerception,
  defaultBaseMonth,
  type ConstructionPerception,
  type EcosIndicatorKey,
  type RawSeries,
} from '@/domain/risk/construction-perception/construction-perception';
import { forecastErrorAt } from '@/domain/risk/construction-perception/forecast-error';
import { REPORT_LAG_MONTHS, SCORING_RULES, type IndicatorKey } from '@/domain/risk/construction-perception/policy';
import { addMonths, compareYearMonth, yearMonthOfDate, type YearMonth } from '@/domain/shared/year-month';

export type PerceptionRequest = {
  /** 사용자가 고른 기준월. 있으면 가장 우선이다. */
  readonly baseMonth?: YearMonth;
  /** 보고월 = 올린 최신 회차의 기준월. */
  readonly reportMonth?: YearMonth;
};

/** 기준월이 어디서 왔는가. 화면이 설명 문장을 고를 때 쓴다. */
export type BaseMonthSource = '선택' | '회차' | '오늘';

export type PerceptionBasis = {
  readonly baseMonth: YearMonth;
  /** 선택만 받았으면 없을 수 있다. */
  readonly reportMonth: YearMonth | null;
  readonly source: BaseMonthSource;
};

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
  /** 분양회수 계획·실적 이력: 올라온 회차와 그 사이에 빠진 회차. */
  readonly ledger: {
    readonly latestRound: YearMonth | null;
    readonly rounds: readonly YearMonth[];
    readonly missingRounds: readonly YearMonth[];
  };
  readonly fetchedAt: Date;
};

export type PerceptionReport = {
  readonly basis: PerceptionBasis;
  /** 기준월로 고를 수 있는 범위(정책 §5). from은 이력이 비었으면 없다. */
  readonly selectable: { readonly from: YearMonth | null; readonly to: YearMonth };
  readonly result: ConstructionPerception;
  /** 지표별 최신월·단위·조회 실패, 이력 상태. */
  readonly diagnostics: PerceptionDiagnostics;
};

const ECOS_KEYS = SCORING_RULES.map((r) => r.key).filter(
  (k): k is EcosIndicatorKey => k !== '분양회수예측오차',
);

export async function assessPerception(
  source: EconomicIndicatorSource,
  repo: ForecastLedgerRepository,
  request: PerceptionRequest = {},
  now: () => Date = () => new Date(),
): Promise<Outcome<PerceptionReport>> {
  return settleAsync(async () => {
    const today = yearMonthOfDate(now());
    const basis = basisOf(request, today);

    const fetched = await fetchSafely(source);
    const ledger = await repo.load();

    const series = {} as Record<EcosIndicatorKey, RawSeries>;
    const statuses = new Map<IndicatorKey, IndicatorStatus>();
    for (const key of ECOS_KEYS) {
      const f = fetched[key];
      if ('error' in f) {
        series[key] = new Map();
        statuses.set(key, { key, latest: null, error: f.error });
      } else {
        series[key] = f.values;
        statuses.set(key, { key, latest: lastMonthOf(f.values), unit: f.unit });
      }
    }
    // 분양회수의 최신월 = 이력의 마지막 회차(기준월 t에는 t월·t−2월 회차가 필요하다).
    statuses.set('분양회수예측오차', { key: '분양회수예측오차', latest: ledger.latestRound() });

    const result = assessConstructionPerception(
      { series, forecastError: (t) => forecastErrorAt(ledger, t) },
      basis.baseMonth,
    );

    const firstRound = ledger.firstRound();
    return succeed({
      basis,
      selectable: {
        // 기준월 t에는 t−2월 회차가 필요하므로 첫 회차 + 2부터 고를 수 있다.
        from: firstRound === null ? null : addMonths(firstRound, REPORT_LAG_MONTHS),
        to: addMonths(today, -1),
      },
      result: explain(result, statuses, ledger),
      diagnostics: {
        indicators: SCORING_RULES.map((r) => statuses.get(r.key) as IndicatorStatus),
        ledger: {
          latestRound: ledger.latestRound(),
          rounds: [...ledger.rounds()],
          missingRounds: [...ledger.missingRounds()],
        },
        fetchedAt: earliestFetch(fetched) ?? now(),
      },
    });
  }, '건설경기 인식 지수를 산출하지 못했습니다.');
}

function basisOf(request: PerceptionRequest, today: YearMonth): PerceptionBasis {
  if (request.baseMonth !== undefined) {
    return { baseMonth: request.baseMonth, reportMonth: request.reportMonth ?? null, source: '선택' };
  }
  if (request.reportMonth !== undefined) {
    return { baseMonth: defaultBaseMonth(request.reportMonth), reportMonth: request.reportMonth, source: '회차' };
  }
  return { baseMonth: defaultBaseMonth(today), reportMonth: today, source: '오늘' };
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

/**
 * 화면에 보일 조회 시각. 캐시에서 꺼낸 값이면 처음 받은 시각이어야 한다 —
 * 산출 시각을 보이면 10분 묵은 값이 방금 받은 값처럼 보인다(기준월 계획 B-R3).
 */
function earliestFetch(fetched: SourceResult): Date | null {
  let earliest: Date | null = null;
  for (const f of Object.values(fetched)) {
    if ('fetchedAt' in f && f.fetchedAt !== undefined && (earliest === null || f.fetchedAt < earliest)) {
      earliest = f.fetchedAt;
    }
  }
  return earliest;
}

function lastMonthOf(values: RawSeries): YearMonth | null {
  let last: YearMonth | null = null;
  for (const m of values.keys()) {
    if (last === null || compareYearMonth(m, last) > 0) last = m;
  }
  return last;
}

/**
 * 결측 사유를 조치가 보이게 다듬는다(정책 §5).
 *
 * 도메인은 "그 달 값이 없다"까지만 안다. 왜 없는지 — 조회 실패인지, 아직 공표
 * 전인지, 회차를 안 올렸는지 — 는 지표별 최신월을 아는 여기서 가른다.
 * 조치가 다르다: 다시 시도한다 / 기다린다 / 회차를 올린다.
 */
function explain(
  result: ConstructionPerception,
  statuses: ReadonlyMap<IndicatorKey, IndicatorStatus>,
  ledger: ForecastLedger,
): ConstructionPerception {
  if (result.kind !== 'unavailable') return result;
  const month = result.month;

  return {
    ...result,
    missing: result.missing.map(({ key, reason }) => {
      const status = statuses.get(key);
      if (key === '분양회수예측오차') {
        // 도메인 사유가 이미 어느 회차를 올릴지 적는다. 이력이 통째로 비었을 때만 따로 안내한다.
        if (ledger.latestRound() === null) {
          return { key, reason: '분양회수 계획·실적 이력이 비어 있습니다. 최신 회차를 올리세요.' };
        }
        return { key, reason };
      }
      if (status?.error !== undefined) return { key, reason: `ECOS 조회 실패: ${status.error}` };
      if (status?.latest === null) return { key, reason: 'ECOS에 이 지표의 값이 하나도 없습니다.' };
      if (status !== undefined && status.latest !== null && compareYearMonth(month, status.latest) > 0) {
        return { key, reason: `아직 공표 전입니다(ECOS 최신 ${status.latest}).` };
      }
      return { key, reason };
    }),
  };
}
