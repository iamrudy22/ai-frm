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
