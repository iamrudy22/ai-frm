import { describe, it, expect } from 'vitest';
import { assessPerception } from '@/application/construction-perception';
import type { EconomicIndicatorSource, ForecastLedgerRepository, SourceResult } from '@/application/ports';
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

class FixedSource implements EconomicIndicatorSource {
  constructor(private readonly over: Partial<SourceResult> = {}) {}
  async fetchAll(): Promise<SourceResult> {
    const all = Object.fromEntries(
      ECOS_KEYS.map((key) => [
        key,
        { values: flat(['주택매매가격지수', '환율', '주가'].includes(key) ? '2026/08' : '2026/07'), unit: '단위' },
      ]),
    ) as SourceResult;
    return { ...all, ...this.over };
  }
}

class MemoryRepository implements ForecastLedgerRepository {
  constructor(private readonly ledger: ForecastLedger) {}
  async load() {
    return this.ledger;
  }
  async save() {}
}

function entry(round: YearMonth): RoundEntry {
  return {
    round,
    actual: { month: addMonths(round, -1), value: amount(110) },
    plan: { month: round, values: [amount(100), amount(100), amount(100)], beyondPlanYear: false },
  };
}

/** 5·6·7·8월 회차가 모두 올라온 이력 — 분양회수 최신월은 7월, 오차율 +10%(0점). */
function ledgerThrough(rounds: string[] = ['2026/05', '2026/06', '2026/07', '2026/08']): ForecastLedger {
  return rounds.reduce((l, r) => l.record(entry(ym(r))), emptyLedger());
}

const NOW = new Date(2026, 8, 28, 9, 0);

describe('건설경기 인식 지수 산출', () => {
  it('가장 늦게 나오는 지표가 기준월을 정하고, 그 달을 산출한다', async () => {
    const out = await assessPerception(new FixedSource(), new MemoryRepository(ledgerThrough()), () => NOW);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.result).toMatchObject({ kind: 'ok', month: '2026/07', index: 0, grade: '정상' });
  });

  it('진단에 지표별 최신월·단위와 이력 상태, 조회 시각을 담는다', async () => {
    const out = await assessPerception(new FixedSource(), new MemoryRepository(ledgerThrough()), () => NOW);
    if (!out.ok) throw new Error(out.reason);
    const d = out.value.diagnostics;
    expect(d.fetchedAt).toBe(NOW);
    expect(d.indicators.find((i) => i.key === '환율')).toEqual({ key: '환율', latest: '2026/08', unit: '단위' });
    expect(d.indicators.find((i) => i.key === '분양회수예측오차')).toEqual({ key: '분양회수예측오차', latest: '2026/07' });
    expect(d.ledger).toEqual({ latestActualMonth: '2026/07', gaps: [] });
  });

  it('ECOS 한 지표가 실패하면 산출불가이고, 사유에 조회 실패가 적힌다', async () => {
    const source = new FixedSource({ 환율: { error: 'ERROR-500 서버 오류' } });
    const out = await assessPerception(source, new MemoryRepository(ledgerThrough()), () => NOW);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.result).toEqual({
      kind: 'unavailable',
      month: null,
      missing: [{ key: '환율', reason: expect.stringContaining('ERROR-500') }],
    });
    expect(out.value.diagnostics.indicators.find((i) => i.key === '환율')).toEqual({
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
    const out = await assessPerception(source, new MemoryRepository(ledgerThrough()), () => NOW);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.result.kind).toBe('unavailable');
    if (out.value.result.kind !== 'unavailable') return;
    expect(out.value.result.missing).toHaveLength(9);
    expect(out.value.result.missing[0].reason).toContain('ECOS_API_KEY');
  });

  it('값이 하나도 없는 지표는 최신월을 알 수 없다', async () => {
    const source = new FixedSource({ 주가: { values: new Map(), unit: '지수' } });
    const out = await assessPerception(source, new MemoryRepository(ledgerThrough()), () => NOW);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.result).toMatchObject({ kind: 'unavailable', month: null });
  });

  it('이력에 빈 달이 있으면 산출불가이고, 진단에 빈 달이 나온다 — 이전 달로 내려가지 않는다', async () => {
    const repo = new MemoryRepository(ledgerThrough(['2026/05', '2026/06', '2026/08'])); // 7월 회차 누락
    const out = await assessPerception(new FixedSource(), repo, () => NOW);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.result).toMatchObject({ kind: 'unavailable', month: '2026/07' });
    expect(out.value.diagnostics.ledger.gaps).toEqual(['2026/06', '2026/07']);
  });

  it('이력이 비어 있으면 분양회수의 최신월을 알 수 없어 산출불가다', async () => {
    const out = await assessPerception(new FixedSource(), new MemoryRepository(emptyLedger()), () => NOW);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.result).toEqual({
      kind: 'unavailable',
      month: null,
      missing: [{ key: '분양회수예측오차', reason: expect.stringContaining('이력') }],
    });
  });

  it('이력 저장소가 실패하면 산출 자체가 실패다', async () => {
    const repo: ForecastLedgerRepository = {
      load: async () => {
        throw new Error('이력 파일이 손상되었습니다');
      },
      save: async () => {},
    };
    expect(await assessPerception(new FixedSource(), repo, () => NOW)).toEqual({
      ok: false,
      reason: '이력 파일이 손상되었습니다',
    });
  });
});
