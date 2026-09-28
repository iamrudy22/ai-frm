import { describe, it, expect } from 'vitest';
import { assessPerception, type PerceptionRequest } from '@/application/construction-perception';
import type { EconomicIndicatorSource, SourceResult } from '@/application/ports';
import { emptyLedger, type ForecastLedger } from '@/domain/cashflow/forecast-ledger';
import type { RoundEntry } from '@/domain/cashflow/round-entry';
import type { EcosIndicatorKey } from '@/domain/risk/construction-perception/construction-perception';
import { amount } from '@/domain/shared/amount';
import { addMonths, compareYearMonth, parseYearMonth, type YearMonth } from '@/domain/shared/year-month';

const ym = (s: string) => parseYearMonth(s);

const ECOS_KEYS: EcosIndicatorKey[] = [
  '총수주액', '주택매매가격지수', '미분양주택현황', '주택건설인허가실적', '설비투자지수',
  '대출금리', '환율', '주가', '선행지수순환변동치',
];

/** 2025/01부터 `last`까지 100으로 평평한 계열 — 모든 지표가 0점이 된다. */
function flat(last: string): ReadonlyMap<YearMonth, number> {
  const map = new Map<YearMonth, number>();
  for (let m = ym('2025/01'); compareYearMonth(m, ym(last)) <= 0; m = addMonths(m, 1)) map.set(m, 100);
  return map;
}

/** 기본: KB지수·환율·주가는 8월까지, 나머지는 7월까지 공표(2026-09 실제와 같은 모양). */
const EARLY = ['주택매매가격지수', '환율', '주가'];

class FixedSource implements EconomicIndicatorSource {
  constructor(
    private readonly over: Partial<SourceResult> = {},
    private readonly lastOf: (key: EcosIndicatorKey) => string = (key) => (EARLY.includes(key) ? '2026/08' : '2026/07'),
  ) {}
  async fetchAll(): Promise<SourceResult> {
    const all = Object.fromEntries(
      ECOS_KEYS.map((key) => [key, { values: flat(this.lastOf(key)), unit: '단위' }]),
    ) as SourceResult;
    return { ...all, ...this.over };
  }
}

/** 회차 기재분: 시트 첫 달부터 직전 달까지 실적 110, 그달부터 4개월 계획 100. */
function entry(round: YearMonth): RoundEntry {
  const sheetStart = ym(`${round.slice(0, 4)}/01`);
  const actuals = [];
  for (let m = sheetStart; m < round; m = addMonths(m, 1)) actuals.push({ month: m, value: amount(110) });
  const plan = (i: number) => ({ month: addMonths(round, i), value: amount(100) });
  return { round, sheetStart, actuals, plans: [plan(0), plan(1), plan(2), plan(3)] };
}

/** 2~9월 회차를 모두 올린 경우 — 오차율 (330 − 300) ÷ 300 = +10%(0점). */
// 회차 없이 보면 기준월은 오늘(9월) − 2 = 7월이고, 분양회수에 6월(계획)·9월(실적) 회차가 필요하다.
const ROUNDS = ['2026/02', '2026/03', '2026/04', '2026/05', '2026/06', '2026/07', '2026/08', '2026/09'];
function ledgerThrough(rounds: string[] = ROUNDS): ForecastLedger {
  return rounds.reduce((l, r) => l.record(entry(ym(r))), emptyLedger());
}

const NOW = new Date(2026, 8, 28, 9, 0);

async function assess(
  request: PerceptionRequest = {},
  source: EconomicIndicatorSource = new FixedSource(),
  ledger: ForecastLedger = ledgerThrough(),
) {
  const out = await assessPerception(source, ledger, request, () => NOW);
  if (!out.ok) throw new Error(out.reason);
  return out.value;
}

describe('기준월 결정 (정책 §5, 2026-09-28 개정)', () => {
  it('회차도 선택도 없으면 오늘(9월) − 2 = 7월', async () => {
    const r = await assess();
    expect(r.basis).toEqual({ baseMonth: '2026/07', reportMonth: '2026/09', source: '오늘' });
    expect(r.result).toMatchObject({ kind: 'ok', month: '2026/07', index: 0, grade: '정상' });
  });

  // 8월 기준 분양회수는 8월 회차의 5·6·7월 실적과 5월 회차의 계획이다(엑셀 "2026/08" 행과 같은 창).
  it('8월 기준(최신 회차 8월)이면 기준월 6월이고, 5·8월 회차 두 개면 산출된다', async () => {
    const r = await assess({ reportMonth: ym('2026/08') }, new FixedSource(), ledgerThrough(['2026/05', '2026/08']));
    expect(r.basis).toEqual({ baseMonth: '2026/06', reportMonth: '2026/08', source: '회차' });
    expect(r.result).toMatchObject({ kind: 'ok', month: '2026/06' });
  });

  it('7월 기준이면 기준월 5월이다', async () => {
    const r = await assess({ reportMonth: ym('2026/07') });
    expect(r.basis).toEqual({ baseMonth: '2026/05', reportMonth: '2026/07', source: '회차' });
    expect(r.result).toMatchObject({ kind: 'ok', month: '2026/05' });
  });

  it('사용자가 고른 달이 가장 우선이다', async () => {
    const r = await assess({ reportMonth: ym('2026/08'), baseMonth: ym('2026/05') });
    expect(r.basis).toEqual({ baseMonth: '2026/05', reportMonth: '2026/08', source: '선택' });
    expect(r.result).toMatchObject({ kind: 'ok', month: '2026/05' });
  });

  it('고를 수 있는 범위: 올린 첫 회차 + 1부터 오늘의 전달까지', async () => {
    expect((await assess()).selectable).toEqual({ from: '2026/03', to: '2026/08' });
    expect((await assess({}, new FixedSource(), emptyLedger())).selectable).toEqual({
      from: null,
      to: '2026/08',
    });
  });
});

describe('산출불가 사유', () => {
  it('기준월이 ECOS 최신월보다 뒤면 "공표 전"이다 — 값이 빠진 것과 구분한다', async () => {
    const r = await assess({}, new FixedSource({}, () => '2026/06'));
    expect(r.result.kind).toBe('unavailable');
    if (r.result.kind !== 'unavailable') return;
    expect(r.result.month).toBe('2026/07');
    expect(r.result.missing).toHaveLength(9);
    for (const m of r.result.missing) expect(m.reason).toBe('아직 공표 전입니다(ECOS 최신 2026/06).');
  });

  it('실적을 읽을 회차를 올리지 않았으면 그 회차를 올리라고 알린다', async () => {
    const ledger = ledgerThrough(ROUNDS.slice(0, 5)); // 2~6월 회차만 — 기준월 7월의 실적을 읽을 9월 회차 없음
    const r = await assess({}, new FixedSource(), ledger);
    expect(r.result).toEqual({
      kind: 'unavailable',
      month: '2026/07',
      missing: [{ key: '분양회수예측오차', reason: '분양회수: 실적을 읽는 2026/09 회차를 올리지 않았습니다.' }],
    });
  });

  it('ECOS 한 지표가 실패하면 그 지표만 조회 실패로 산출불가다 — 기준월은 그대로', async () => {
    const r = await assess({}, new FixedSource({ 환율: { error: 'ERROR-500 서버 오류' } }));
    expect(r.result).toEqual({
      kind: 'unavailable',
      month: '2026/07',
      missing: [{ key: '환율', reason: 'ECOS 조회 실패: ERROR-500 서버 오류' }],
    });
    expect(r.diagnostics.indicators.find((i) => i.key === '환율')).toEqual({
      key: '환율',
      latest: null,
      error: 'ERROR-500 서버 오류',
    });
  });

  it('ECOS 조회 자체가 실패하면 9종 모두 조회 실패다', async () => {
    const source: EconomicIndicatorSource = {
      fetchAll: async () => {
        throw new Error('ECOS_API_KEY가 설정되지 않았습니다.');
      },
    };
    const r = await assess({}, source);
    if (r.result.kind !== 'unavailable') throw new Error(r.result.kind);
    expect(r.result.missing).toHaveLength(9);
    expect(r.result.missing[0].reason).toContain('ECOS_API_KEY');
  });

  it('ECOS에 값이 하나도 없는 지표', async () => {
    const r = await assess({}, new FixedSource({ 주가: { values: new Map(), unit: '지수' } }));
    expect(r.result).toMatchObject({
      kind: 'unavailable',
      missing: [{ key: '주가', reason: 'ECOS에 이 지표의 값이 하나도 없습니다.' }],
    });
  });

  it('계획 회차가 빠지면 이전 달로 내려가지 않고 산출불가다 — 사이 회차는 없어도 된다', async () => {
    const r = await assess({}, new FixedSource(), ledgerThrough(['2026/05', '2026/09'])); // 6월(계획) 회차 없음
    expect(r.result).toEqual({
      kind: 'unavailable',
      month: '2026/07',
      missing: [{ key: '분양회수예측오차', reason: '분양회수: 계획을 세운 2026/06 회차를 올리지 않았습니다.' }],
    });
    expect((await assess({}, new FixedSource(), ledgerThrough(['2026/06', '2026/09']))).result).toMatchObject({ kind: 'ok' });
  });

  it('회차를 하나도 올리지 않았으면 무엇이 필요한지 알린다', async () => {
    const r = await assess({}, new FixedSource(), emptyLedger());
    expect(r.result).toEqual({
      kind: 'unavailable',
      month: '2026/07',
      missing: [{ key: '분양회수예측오차', reason: '분양회수: 자금수지표 회차를 올리지 않았습니다. 기준월 2026/07에는 2026/06 회차(계획)와 2026/09 회차(실적)가 필요합니다.' }],
    });
  });
});

describe('진단과 실패', () => {
  it('지표별 최신월·단위, 이력 상태, 조회 시각을 담는다', async () => {
    const d = (await assess()).diagnostics;
    expect(d.fetchedAt).toBe(NOW);
    expect(d.indicators.find((i) => i.key === '환율')).toEqual({ key: '환율', latest: '2026/08', unit: '단위' });
    expect(d.indicators.find((i) => i.key === '분양회수예측오차')).toEqual({
      key: '분양회수예측오차',
      latest: '2026/09',
    });
    expect(d.ledger).toEqual({ latestRound: '2026/09', rounds: ROUNDS });
  });

  it('조회 시각은 산출 시각이 아니라 ECOS 응답을 받은 시각이다 — 캐시된 값이면 그때 시각', async () => {
    const earlier = new Date(2026, 8, 28, 8, 55);
    const source = new FixedSource();
    const stamped: EconomicIndicatorSource = {
      fetchAll: async () =>
        Object.fromEntries(
          Object.entries(await source.fetchAll()).map(([k, f]) => [k, { ...f, fetchedAt: earlier }]),
        ) as SourceResult,
    };
    expect((await assess({}, stamped)).diagnostics.fetchedAt).toBe(earlier);
  });
});
