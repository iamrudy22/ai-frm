import { describe, it, expect } from 'vitest';
import type { EconomicIndicatorSource, IndicatorFetch, SourceResult } from '@/application/ports';
import { CachedIndicatorSource } from '@/infrastructure/ecos/cached-indicator-source';
import { ECOS_SERIES } from '@/infrastructure/ecos/ecos-indicator-source';

const ok: IndicatorFetch = { values: new Map(), unit: '단위' };
const allOk = () => Object.fromEntries(ECOS_SERIES.map((s) => [s.key, ok])) as SourceResult;

class CountingSource implements EconomicIndicatorSource {
  calls = 0;
  constructor(private readonly make: () => Promise<SourceResult> = async () => allOk()) {}
  fetchAll() {
    this.calls++;
    return this.make();
  }
}

const TEN_MINUTES = 10 * 60 * 1000;

describe('ECOS 조회 캐시', () => {
  it('10분 안에 다시 부르면 ECOS를 부르지 않는다 — 기준월을 바꿔도 계열은 같다', async () => {
    let t = 0;
    const inner = new CountingSource();
    const cached = new CachedIndicatorSource(inner, TEN_MINUTES, () => t);
    await cached.fetchAll();
    t = TEN_MINUTES - 1;
    await cached.fetchAll();
    expect(inner.calls).toBe(1);
  });

  it('10분이 지나면 다시 부른다', async () => {
    let t = 0;
    const inner = new CountingSource();
    const cached = new CachedIndicatorSource(inner, TEN_MINUTES, () => t);
    await cached.fetchAll();
    t = TEN_MINUTES;
    await cached.fetchAll();
    expect(inner.calls).toBe(2);
  });

  it('한 지표라도 실패한 결과는 캐시하지 않는다 — 다음 요청에서 다시 시도한다', async () => {
    const inner = new CountingSource(async () => ({ ...allOk(), 환율: { error: 'ERROR-500' } }));
    const cached = new CachedIndicatorSource(inner, TEN_MINUTES, () => 0);
    await cached.fetchAll();
    await cached.fetchAll();
    expect(inner.calls).toBe(2);
  });

  it('조회가 던지면 그대로 던지고 캐시하지 않는다', async () => {
    let fail = true;
    const inner = new CountingSource(async () => {
      if (fail) throw new Error('ECOS_API_KEY가 설정되지 않았습니다.');
      return allOk();
    });
    const cached = new CachedIndicatorSource(inner, TEN_MINUTES, () => 0);
    await expect(cached.fetchAll()).rejects.toThrow(/ECOS_API_KEY/);
    fail = false;
    await cached.fetchAll();
    expect(inner.calls).toBe(2);
  });

  it('비어 있을 때 동시에 온 요청은 조회 하나를 함께 기다린다', async () => {
    const inner = new CountingSource();
    const cached = new CachedIndicatorSource(inner, TEN_MINUTES, () => 0);
    const [a, b] = await Promise.all([cached.fetchAll(), cached.fetchAll()]);
    expect(inner.calls).toBe(1);
    expect(a).toBe(b);
  });
});
