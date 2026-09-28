import { describe, it, expect } from 'vitest';
import { handlePerception } from '@/app/api/_lib/handlers';
import type { EconomicIndicatorSource } from '@/application/ports';

const noKey: EconomicIndicatorSource = {
  fetchAll: async () => {
    throw new Error('ECOS_API_KEY가 설정되지 않았습니다.');
  },
};

/** 8월 회차 기재분 — 시트가 8월부터라 실적 칸이 없다. */
const round = (r: string) => ({
  round: r,
  sheetStart: r,
  actuals: [],
  plans: [0, 1, 2, 3].map((i) => ({ month: `2026/${String(Number(r.slice(5)) + i).padStart(2, '0')}`, value: 100 + i })),
});

const post = (payload: unknown) =>
  new Request('http://localhost/api/construction-perception', {
    method: 'POST',
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });

const call = (payload: unknown) => handlePerception(post(payload), noKey);

describe('POST /api/construction-perception', () => {
  it('산출 결과를 JSON으로 돌려준다 — 키가 없으면 산출불가와 사유다', async () => {
    const res = await call({ rounds: [] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.value.result.kind).toBe('unavailable');
    expect(json.value.result.missing[0].reason).toContain('ECOS_API_KEY');
    expect(typeof json.value.diagnostics.fetchedAt).toBe('string');
  });

  it('본문의 회차들로만 계산한다 — 저장하지 않으므로 다음 요청에 남지 않는다', async () => {
    const first = await (await call({ rounds: [round('2026/07'), round('2026/08')] })).json();
    expect(first.value.diagnostics.ledger.rounds).toEqual(['2026/07', '2026/08']);
    const second = await (await call({ rounds: [] })).json();
    expect(second.value.diagnostics.ledger.rounds).toEqual([]);
  });

  it('rounds가 없으면 회차 없이 계산한다', async () => {
    expect((await (await call({})).json()).value.diagnostics.ledger.rounds).toEqual([]);
  });

  it('형식이 틀린 회차는 400이고 몇 번째인지 알린다', async () => {
    const bad = { ...round('2026/08'), plans: round('2026/08').plans.slice(0, 3) };
    const res = await call({ rounds: [round('2026/07'), bad] });
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toMatch(/2번째.*4칸/);
  });

  it('같은 회차가 두 번이면 400이다', async () => {
    const res = await call({ rounds: [round('2026/08'), round('2026/08')] });
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toContain('2026/08 회차가 두 번');
  });

  it('JSON이 아닌 본문은 400이다', async () => {
    expect((await call('{ 깨진')).status).toBe(400);
  });
});

describe('기준월 인자', () => {
  const basisOf = async (payload: object) => (await (await call({ rounds: [], ...payload })).json()).value.basis;

  it('인자가 없으면 오늘 − 2', async () => {
    expect((await basisOf({})).source).toBe('오늘');
  });

  it('reportMonth가 있으면 회차 − 2', async () => {
    expect(await basisOf({ reportMonth: '2026/08' })).toEqual({ baseMonth: '2026/06', reportMonth: '2026/08', source: '회차' });
  });

  it('baseMonth가 있으면 그 달', async () => {
    expect(await basisOf({ baseMonth: '2026/05', reportMonth: '2026/08' })).toEqual({
      baseMonth: '2026/05',
      reportMonth: '2026/08',
      source: '선택',
    });
  });

  it.each([{ baseMonth: '202605' }, { reportMonth: '2026/13' }, { baseMonth: '' }])('형식이 틀리면 400이다 — %o', async (payload) => {
    const res = await call({ rounds: [], ...payload });
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toMatch(/YYYY\/MM|1~12/);
  });
});
