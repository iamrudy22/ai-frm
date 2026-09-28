/**
 * 채권정보센터 ACL — 녹화한 실제 응답(공개 시장 데이터)으로 번역을 검증한다. 네트워크는 부르지 않는다.
 *
 * 녹화 파일은 __fixtures__/에 있다. 응답 헤더의 접속 IP는 0.0.0.0으로 지웠다.
 *   2026-07.xml  7월 1일~31일, 22개 평가일. 7/31이 화면 캡처와 같은 값이다
 *   2026-05.xml  말일(5/31)이 일요일이라 마지막 평가일이 5/29다
 *   2022-12.xml  3사 평균(2023/01/09~) 전이라 행은 오고 값이 빈칸이다
 *   2026-10.xml  아직 오지 않은 달이라 0건이다
 *   module-error.xml  없는 함수를 불렀을 때의 오류 응답(HTTP 200)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { YieldFetch } from '@/application/ports';
import { KofiaYieldSource, requestBody } from '@/infrastructure/kofia/kofia-yield-source';
import { parseYearMonth } from '@/domain/shared/year-month';

const recorded = (name: string) =>
  readFileSync(resolve(process.cwd(), 'src/infrastructure/kofia/__fixtures__', name), 'utf8');

type Call = { url: string; init?: RequestInit };

function fakeFetch(body: string | Error, calls: Call[] = [], status = 200) {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (body instanceof Error) throw body;
    return new Response(body, { status, headers: { 'content-type': 'text/xml;charset=UTF-8' } });
  };
}

const NOW = () => new Date(2026, 8, 28);

const fetchMonth = (body: string | Error, month: string, calls: Call[] = [], status = 200) =>
  new KofiaYieldSource(fakeFetch(body, calls, status), NOW).dailyYields(parseYearMonth(month));

function days(result: YieldFetch) {
  if ('error' in result) throw new Error(result.error);
  return result.days;
}

describe('요청', () => {
  it('화면과 같은 곳에 같은 모양으로 보낸다 — 본문은 XML, 헤더는 form-urlencoded', async () => {
    const calls: Call[] = [];
    await fetchMonth(recorded('2026-07.xml'), '2026/07', calls);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://www.kofiabond.or.kr/proframeWeb/XMLSERVICES/');
    expect(calls[0].init?.method).toBe('POST');
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded; charset=UTF-8',
    );
  });

  it('관측월 1일~말일을 한 번에 부른다 — 말일이 평가일이 아니어도 그 전 평가일이 들어온다', async () => {
    const calls: Call[] = [];
    await fetchMonth(recorded('2026-05.xml'), '2026/05', calls);
    const body = String(calls[0].init?.body);
    expect(body).toContain('<standardDt1>20260501</standardDt1>');
    expect(body).toContain('<standardDt2>20260531</standardDt2>');
  });

  it('공사채 AAA 1년을 첫째, 국고채 1년을 둘째 칸에, 3사를 평가사 평균으로 묻는다', () => {
    const body = requestBody('20260731', '20260731');
    expect(body).toMatch(/<val31>3030110<\/val31>\s*<val32>0100<\/val32>\s*<val33>1010000<\/val33>\s*<val34>0100<\/val34>/);
    expect(body).toContain('<creditEstOrgCd>A20000</creditEstOrgCd>');
    expect(body).toMatch(/<val1>A10002<\/val1>\s*<val2>A10003<\/val2>\s*<val3>A10004<\/val3>\s*<val4><\/val4>\s*<val5><\/val5>/);
    expect(body).toContain('<pfmFnName>selectTrm</pfmFnName>');
  });
});

describe('응답 번역', () => {
  it('평가일마다 공사채 AAA·국고채의 3사 값과 평균을 읽는다 — 7/31은 화면과 같다', async () => {
    const result = days(await fetchMonth(recorded('2026-07.xml'), '2026/07'));
    expect(result).toHaveLength(22);
    expect(result.find((d) => d.date === '2026/07/31')).toEqual({
      date: '2026/07/31',
      publicAaa: { average: 3.674, byAgency: { 나이스피앤아이: 3.68, 한국자산평가: 3.665, KIS자산평가: 3.679 } },
      treasury: { average: 3.393, byAgency: { 나이스피앤아이: 3.395, 한국자산평가: 3.39, KIS자산평가: 3.395 } },
    });
  });

  it('평가일만 온다 — 5/31(일)은 없고 5/29가 마지막이다', async () => {
    const dates = days(await fetchMonth(recorded('2026-05.xml'), '2026/05')).map((d) => d.date);
    expect(dates).not.toContain('2026/05/31');
    expect([...dates].sort().at(-1)).toBe('2026/05/29');
  });

  it('3사 평균은 출처가 낸 값 그대로다 — 셋째 자리 아래를 버린 값이다', async () => {
    const may27 = days(await fetchMonth(recorded('2026-05.xml'), '2026/05')).find((d) => d.date === '2026/05/27');
    // (3.385 + 3.389 + 3.389) / 3 = 3.38767 — 반올림하면 3.388이지만 출처는 3.387이다.
    expect(may27?.publicAaa.average).toBe(3.387);
  });

  it('빈칸은 null이다 — 0으로 읽지 않는다', async () => {
    const result = days(await fetchMonth(recorded('2022-12.xml'), '2022/12'));
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((d) => d.publicAaa.average === null && d.treasury.average === null)).toBe(true);
    expect(result[0].publicAaa.byAgency.나이스피앤아이).toBeNull();
  });

  it('평가일이 없는 달은 빈 목록이다 — 실패가 아니다', async () => {
    const result = await fetchMonth(recorded('2026-10.xml'), '2026/10');
    expect(result).toEqual({ days: [], fetchedAt: NOW() });
  });

  it('응답을 받은 시각을 찍어 둔다', async () => {
    const result = await fetchMonth(recorded('2026-07.xml'), '2026/07');
    expect('fetchedAt' in result && result.fetchedAt).toEqual(NOW());
  });
});

describe('실패', () => {
  it('오류도 HTTP 200으로 온다 — 응답 코드와 설명을 사유로', async () => {
    const result = await fetchMonth(recorded('module-error.xml'), '2026/07');
    expect(result).toEqual({ error: expect.stringMatching(/^COMS9009 proframe service operation .* is not found\.$/) });
  });

  it('HTTP 오류', async () => {
    expect(await fetchMonth('', '2026/07', [], 503)).toEqual({ error: 'HTTP 503' });
  });

  it('네트워크 오류는 던지지 않고 사유로 돌려준다', async () => {
    expect(await fetchMonth(new Error('fetch failed'), '2026/07')).toEqual({ error: 'fetch failed' });
  });

  it('목록이 없으면 형식이 바뀐 것이다', async () => {
    const result = await fetchMonth('<html>점검 중</html>', '2026/07');
    expect(result).toEqual({ error: expect.stringContaining('형식이 바뀌었을 수 있습니다') });
  });

  it('건수가 맞지 않으면 쓰지 않는다', async () => {
    const cut = recorded('2026-07.xml').replace('<dbio_total_count_>22<', '<dbio_total_count_>23<');
    expect(await fetchMonth(cut, '2026/07')).toEqual({ error: '전체 23건이라는데 22건을 읽었습니다.' });
  });

  it('평가일을 읽을 수 없으면 쓰지 않는다', async () => {
    const broken = recorded('2026-07.xml').replace('<standardDt>20260731<', '<standardDt>2026-07-31<');
    expect(await fetchMonth(broken, '2026/07')).toEqual({ error: '평가일을 읽을 수 없습니다: 2026-07-31' });
  });
});
