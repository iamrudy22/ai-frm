/**
 * ECOS ACL — 녹화한 실제 응답(공개 통계)으로 번역을 검증한다. 네트워크는 부르지 않는다.
 *
 * 녹화 파일은 __fixtures__/에 있다. 응답 본문에는 인증키가 들어가지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EcosIndicatorSource, ECOS_SERIES } from '@/infrastructure/ecos/ecos-indicator-source';

const recorded = (name: string) =>
  readFileSync(resolve(process.cwd(), 'src/infrastructure/ecos/__fixtures__', name), 'utf8');

type Call = { url: string };

/** 통계표 코드로 응답을 고른다. 지정하지 않은 통계표는 '데이터 없음'이다. */
function fakeFetch(byStat: Record<string, string | Error>, calls: Call[] = []) {
  return async (url: string) => {
    calls.push({ url });
    const stat = Object.keys(byStat).find((code) => url.includes(`/${code}/`));
    const body = stat === undefined ? recorded('no-data.json') : byStat[stat];
    if (body instanceof Error) throw body;
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

const NOW = () => new Date(2026, 8, 28);

describe('ECOS 응답 번역', () => {
  it('TIME·DATA_VALUE·UNIT_NAME을 달력 월별 수와 단위로 바꾼다', async () => {
    const source = new EcosIndicatorSource('KEY', fakeFetch({ '901Y020': recorded('construction-orders.json') }), NOW);
    const result = (await source.fetchAll()).총수주액;
    if ('error' in result) throw new Error(result.error);
    expect(result.unit).toBe('백만원');
    expect([...result.values.keys()]).toEqual(['2026/04', '2026/05', '2026/06', '2026/07']);
    expect(result.values.get('2026/07' as never)).toBe(14357324);
  });

  it('응답을 받은 시각을 찍어 둔다 — 캐시에서 꺼내도 실제 조회 시각이 보이게', async () => {
    const source = new EcosIndicatorSource('KEY', fakeFetch({ '901Y020': recorded('construction-orders.json') }), NOW);
    const result = (await source.fetchAll()).총수주액;
    if ('error' in result) throw new Error(result.error);
    expect(result.fetchedAt).toEqual(NOW());
  });

  it('환율은 항목코드 두 개(원/달러, 평균자료)로 부른다', async () => {
    const calls: Call[] = [];
    const source = new EcosIndicatorSource(
      'KEY',
      fakeFetch({ '731Y004': recorded('exchange-rate.json') }, calls),
      NOW,
    );
    const result = (await source.fetchAll()).환율;
    if ('error' in result) throw new Error(result.error);
    expect(result.values.size).toBe(3);
    expect(calls.find((c) => c.url.includes('731Y004'))?.url).toMatch(/\/731Y004\/M\/201501\/202609\/0000001\/0000100$/);
  });

  it('2015/01부터 이번 달까지, 한 번에 1000건을 부른다', async () => {
    const calls: Call[] = [];
    await new EcosIndicatorSource('KEY', fakeFetch({}, calls), NOW).fetchAll();
    expect(calls).toHaveLength(9);
    expect(calls[0].url).toBe('https://ecos.bok.or.kr/api/StatisticSearch/KEY/json/kr/1/1000/901Y020/M/201501/202609/I42A');
  });

  it('데이터가 없다는 응답(INFO-200)은 빈 계열이다', async () => {
    const result = (await new EcosIndicatorSource('KEY', fakeFetch({}), NOW).fetchAll()).주가;
    expect(result).toEqual({ values: new Map(), unit: '', fetchedAt: NOW() });
  });

  it('키 오류 같은 RESULT 응답은 그 지표의 실패다 — HTTP 200이어도', async () => {
    const source = new EcosIndicatorSource('KEY', fakeFetch({ '901Y014': recorded('bad-key.json') }), NOW);
    const result = (await source.fetchAll()).주가;
    expect(result).toEqual({ error: expect.stringContaining('INFO-100') });
  });

  it('받은 행이 전체 건수보다 적으면 잘린 계열이라 쓰지 않는다', async () => {
    const source = new EcosIndicatorSource('KEY', fakeFetch({ '901Y020': recorded('truncated.json') }), NOW);
    expect((await source.fetchAll()).총수주액).toEqual({ error: expect.stringContaining('잘렸') });
  });

  it('한 지표의 네트워크 실패가 다른 지표를 막지 않는다', async () => {
    const source = new EcosIndicatorSource(
      'KEY',
      fakeFetch({ '901Y020': new TypeError('fetch failed'), '731Y004': recorded('exchange-rate.json') }),
      NOW,
    );
    const all = await source.fetchAll();
    expect(all.총수주액).toEqual({ error: expect.stringContaining('fetch failed') });
    expect('values' in all.환율).toBe(true);
  });

  it('오류 사유에 인증키가 들어가지 않는다', async () => {
    const source = new EcosIndicatorSource(
      'SECRET-KEY-123',
      fakeFetch({ '901Y020': new TypeError('connect ECONNREFUSED'), '901Y014': recorded('bad-key.json') }),
      NOW,
    );
    const all = await source.fetchAll();
    expect(JSON.stringify(all)).not.toContain('SECRET-KEY-123');
  });

  it('키가 없으면 조회 전체가 실패한다', async () => {
    await expect(new EcosIndicatorSource(undefined, fakeFetch({}), NOW).fetchAll()).rejects.toThrow(
      /ECOS_API_KEY/,
    );
  });
});

describe('코드표', () => {
  it('9종이고, 인계 문서 §2에서 검증된 코드다', () => {
    expect(ECOS_SERIES.map((s) => [s.key, s.stat, s.items.join('/')])).toEqual([
      ['총수주액', '901Y020', 'I42A'],
      ['주택매매가격지수', '901Y062', 'P63A'],
      ['미분양주택현황', '901Y074', 'I410A'],
      ['주택건설인허가실적', '901Y105', 'ALL'],
      ['설비투자지수', '901Y066', 'I15B'],
      ['대출금리', '121Y006', 'BECBLA01'],
      ['환율', '731Y004', '0000001/0000100'],
      ['주가', '901Y014', '1070000'],
      ['선행지수순환변동치', '901Y067', 'I16E'],
    ]);
  });
});
