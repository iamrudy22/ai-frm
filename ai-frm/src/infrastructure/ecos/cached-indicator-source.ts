/**
 * ECOS 조회 캐시 — 기준월을 바꿀 때마다 9건을 다시 부르지 않게 한다.
 *
 * ECOS는 기준월과 무관하게 2015/01부터의 전체 계열을 돌려주므로, 기준월이
 * 달라도 같은 응답을 재사용할 수 있다. 월 1회 갱신 자료라 10분 늦게 보여도
 * 영향이 작다(기준월 계획 B-R3).
 *
 * - 9종이 모두 성공한 결과만 담는다. 실패는 다음 요청에서 다시 시도한다.
 * - 비어 있을 때 동시에 온 요청은 진행 중인 조회 하나를 함께 기다린다.
 *
 * 서버 프로세스 안에만 있다. 조립 지점이 하나만 만들어 쓴다(composition.ts).
 */

import type { EconomicIndicatorSource, SourceResult } from '@/application/ports';

export class CachedIndicatorSource implements EconomicIndicatorSource {
  private entry: { readonly at: number; readonly result: Promise<SourceResult> } | null = null;

  constructor(
    private readonly inner: EconomicIndicatorSource,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  fetchAll(): Promise<SourceResult> {
    const t = this.now();
    if (this.entry !== null && t - this.entry.at < this.ttlMs) return this.entry.result;

    const result = this.inner.fetchAll();
    const entry = { at: t, result };
    this.entry = entry;

    // 실패했거나 한 지표라도 조회 실패면 비운다. 그사이 새 조회가 들어섰으면 건드리지 않는다.
    const forget = () => {
      if (this.entry === entry) this.entry = null;
    };
    result.then((r) => {
      if (Object.values(r).some((f) => 'error' in f)) forget();
    }, forget);

    return result;
  }
}
