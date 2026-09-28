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
  actual: { month: '2026/07', value: 107 },
  plan: { month: '2026/08', values: [108, 109, 110], beyondPlanYear: false },
};

const post = (payload: unknown) =>
  new Request('http://localhost/api/forecast-ledger/rounds', {
    method: 'POST',
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });

describe('GET /api/construction-perception', () => {
  it('산출 결과를 JSON으로 돌려준다 — 키가 없으면 산출불가와 사유다', async () => {
    const res = await handlePerception(noKey, new MemoryRepository());
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
    const res = await handlePerception(noKey, broken);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, reason: '이력 파일이 JSON이 아닙니다' });
  });
});

describe('POST /api/forecast-ledger/rounds', () => {
  it('기재분을 이력에 반영한다', async () => {
    const repo = new MemoryRepository();
    const res = await handleRecordRound(post(body), repo);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, value: { latestActualMonth: '2026/07', gaps: [] } });
    expect(repo.ledger.latestActualMonth()).toBe('2026/07');
  });

  it('형식이 틀린 본문은 400이고 이력을 건드리지 않는다', async () => {
    const repo = new MemoryRepository();
    const res = await handleRecordRound(post({ ...body, actual: { month: '2026/06', value: 1 } }), repo);
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toContain('직전 달');
    expect(repo.ledger.latestActualMonth()).toBeNull();
  });

  it('JSON이 아닌 본문은 400이다', async () => {
    const res = await handleRecordRound(post('{ 깨진'), new MemoryRepository());
    expect(res.status).toBe(400);
  });
});
