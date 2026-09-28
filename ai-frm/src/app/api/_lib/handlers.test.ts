import { describe, it, expect } from 'vitest';
import { handlePerception, handleRecordRound } from '@/app/api/_lib/handlers';
import type { EconomicIndicatorSource, ForecastLedgerRepository } from '@/application/ports';
import { emptyLedger, type ForecastLedger } from '@/domain/cashflow/forecast-ledger';

class MemoryRepository implements ForecastLedgerRepository {
  constructor(public ledger: ForecastLedger = emptyLedger()) {}
  async load() {
    return this.ledger;
  }
  async save(ledger: ForecastLedger) {
    this.ledger = ledger;
  }
}

const noKey: EconomicIndicatorSource = {
  fetchAll: async () => {
    throw new Error('ECOS_API_KEY가 설정되지 않았습니다.');
  },
};

const body = {
  round: '2026/08',
  sheetStart: '2026/08',
  actuals: [],
  plans: [
    { month: '2026/08', value: 108 },
    { month: '2026/09', value: 109 },
    { month: '2026/10', value: 110 },
    { month: '2026/11', value: 111 },
  ],
};

const post = (payload: unknown) =>
  new Request('http://localhost/api/forecast-ledger/rounds', {
    method: 'POST',
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });

const get = (query = '') => new Request('http://localhost/api/construction-perception' + query);

describe('GET /api/construction-perception', () => {
  it('산출 결과를 JSON으로 돌려준다 — 키가 없으면 산출불가와 사유다', async () => {
    const res = await handlePerception(get(), noKey, new MemoryRepository());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.value.result.kind).toBe('unavailable');
    expect(json.value.result.missing[0].reason).toContain('ECOS_API_KEY');
    expect(typeof json.value.diagnostics.fetchedAt).toBe('string');
  });

  it('이력 저장소가 실패하면 500과 사유다', async () => {
    const broken: ForecastLedgerRepository = {
      load: async () => {
        throw new Error('이력 파일이 JSON이 아닙니다');
      },
      save: async () => {},
    };
    const res = await handlePerception(get(), noKey, broken);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, reason: '이력 파일이 JSON이 아닙니다' });
  });
});

describe('GET 기준월 인자', () => {
  const basisOf = async (query: string) => (await (await handlePerception(get(query), noKey, new MemoryRepository())).json()).value.basis;

  it('인자가 없으면 오늘 − 2', async () => {
    expect((await basisOf('')).source).toBe('오늘');
  });

  it('reportMonth가 있으면 회차 − 2', async () => {
    expect(await basisOf('?reportMonth=2026%2F08')).toEqual({ baseMonth: '2026/06', reportMonth: '2026/08', source: '회차' });
  });

  it('baseMonth가 있으면 그 달', async () => {
    expect(await basisOf('?baseMonth=2026/05&reportMonth=2026/08')).toEqual({
      baseMonth: '2026/05',
      reportMonth: '2026/08',
      source: '선택',
    });
  });

  it.each(['?baseMonth=202605', '?reportMonth=2026/13', '?baseMonth='])('형식이 틀리면 400이다 — %s', async (query) => {
    const res = await handlePerception(get(query), noKey, new MemoryRepository());
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toMatch(/YYYY\/MM|1~12/);
  });
});

describe('POST /api/forecast-ledger/rounds', () => {
  it('기재분을 이력에 반영한다', async () => {
    const repo = new MemoryRepository();
    const res = await handleRecordRound(post(body), repo);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, value: { latestRound: '2026/08', missingRounds: [] } });
    expect(repo.ledger.latestRound()).toBe('2026/08');
  });

  it('형식이 틀린 본문은 400이고 이력을 건드리지 않는다', async () => {
    const repo = new MemoryRepository();
    const res = await handleRecordRound(post({ ...body, plans: body.plans.slice(0, 3) }), repo);
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toContain('4칸');
    expect(repo.ledger.latestRound()).toBeNull();
  });

  it('JSON이 아닌 본문은 400이다', async () => {
    const res = await handleRecordRound(post('{ 깨진'), new MemoryRepository());
    expect(res.status).toBe(400);
  });
});
