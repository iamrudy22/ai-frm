/**
 * 올린 회차 정리 — 파일 입력을 한 곳으로 합친 뒤, 올린 회차 묶음에서 각 지표가
 * 쓸 회차를 고른다.
 *
 *   - 최신 회차: 가장 늦은 회차. 유동성 Gap·적정 시재의 기준이다.
 *   - 이전 회차: 최신 회차의 바로 전 달 회차. 대금 회수 위험이 쓴다. 없으면 없다 —
 *     떨어진 회차를 대신 쓰면 서로 다른 달을 견주게 된다.
 *   - 분양회수: 올린 회차 전부. 건설경기 인식 지수가 쓴다.
 *
 * 같은 회차가 두 번 오면 어느 파일을 믿을지 알 수 없으므로 거부한다.
 */

import { calendarOf, type Statement } from '@/domain/cashflow/statement';
import { baseMonthOfRound } from '@/domain/risk/construction-perception/construction-perception';
import { roundsNeededFor } from '@/domain/risk/construction-perception/forecast-error';
import { addMonths, compareYearMonth, type YearMonth } from '@/domain/shared/year-month';

export type NamedStatement = { readonly file: string; readonly statement: Statement };

export type RoundRole = '최신 회차' | '이전 회차' | '분양회수';

export type UploadedRound = NamedStatement & { readonly round: YearMonth; readonly role: RoundRole };

export type ArrangedRounds =
  | {
      readonly ok: true;
      readonly latest: UploadedRound;
      readonly previous: UploadedRound | null;
      /** 회차 순서. */
      readonly rounds: readonly UploadedRound[];
    }
  | { readonly ok: false; readonly reason: string };

export function arrangeRounds(named: readonly NamedStatement[]): ArrangedRounds {
  if (named.length === 0) return { ok: false, reason: '자금수지표 회차 파일을 올려 주세요.' };

  const withRound = named
    .map((n) => ({ ...n, round: calendarOf(n.statement, n.statement.defaultBaseMonth) }))
    .sort((a, b) => compareYearMonth(a.round, b.round));

  for (let i = 1; i < withRound.length; i++) {
    if (withRound[i].round === withRound[i - 1].round) {
      const files = withRound.filter((x) => x.round === withRound[i].round).map((x) => x.file);
      return { ok: false, reason: `${withRound[i].round} 회차 파일이 두 개입니다: ${files.join(', ')}. 하나만 올려 주세요.` };
    }
  }

  const latestRound = withRound[withRound.length - 1].round;
  const previousRound = addMonths(latestRound, -1);
  const rounds = withRound.map((x): UploadedRound => ({
    ...x,
    role: x.round === latestRound ? '최신 회차' : x.round === previousRound ? '이전 회차' : '분양회수',
  }));

  return {
    ok: true,
    latest: rounds[rounds.length - 1],
    previous: rounds.find((x) => x.role === '이전 회차') ?? null,
    rounds,
  };
}

/** 한 지표가 산출에 쓰는 회차와, 올린 회차에서 빠진 것. */
export type Requirement = {
  readonly indicator: string;
  readonly needed: readonly YearMonth[];
  readonly missing: readonly YearMonth[];
  /** 빠졌을 때 벌어지는 일. 빠질 수 없으면 빈 문자열. */
  readonly ifMissing: string;
};

/**
 * 산출 전에 보이는 필요 회차 확인. 최신 회차(L)가 정해지면 지표마다 필요한 회차가 정해진다.
 *
 *   - 유동성 Gap·적정 시재: L
 *   - 대금 회수 위험: L−1, L
 *   - 건설경기 인식 지수: 기본 기준월 B = L − 1 에서 B−2 ~ B+1, 곧 L−3 ~ L (정책 §3-2, §5)
 *
 * 그래서 7월 기준은 4·5·6·7월 회차 네 개로 모든 지표가 채워진다.
 *
 * 건설경기는 기본 기준월 기준이다. 산출 뒤 기준월을 바꾸면 필요한 회차도 바뀌고,
 * 그때는 카드가 다시 알린다.
 */
export function requirementsOf(rounds: readonly YearMonth[]): Requirement[] {
  const latest = [...rounds].sort(compareYearMonth).at(-1);
  if (latest === undefined) return [];
  const have = new Set(rounds);
  const requirement = (indicator: string, needed: YearMonth[], ifMissing: string): Requirement => ({
    indicator,
    needed,
    missing: needed.filter((r) => !have.has(r)),
    ifMissing,
  });

  const base = baseMonthOfRound(latest);
  const perceptionRounds = roundsNeededFor(base);

  return [
    requirement('유동성 Gap · 적정 시재', [latest], ''),
    requirement('대금 회수 위험', [addMonths(latest, -1), latest], '판정하지 않습니다'),
    requirement(`건설경기 인식 지수 (기준월 ${base})`, perceptionRounds, '기본 기준월로는 산출불가입니다'),
  ];
}

/** 이어진 셋 이상은 `처음~끝`, 아니면 가운뎃점으로 잇는다. */
export function roundsText(rounds: readonly YearMonth[]): string {
  const contiguous = rounds.every((r, i) => i === 0 || r === addMonths(rounds[i - 1], 1));
  if (contiguous && rounds.length >= 3) return `${rounds[0]}~${rounds[rounds.length - 1]}`;
  return rounds.join('·');
}
