/**
 * 금융투자협회 채권정보센터 ACL — 채권시가평가수익률(기간별) 응답을 도메인 언어로 번역한다.
 *
 *   standardDt '20260731'         →  평가일 '2026/07/31'
 *   val1·val2·val3·val6 '3.680'   →  공사채 AAA의 나이스·한국·KIS·3사 평균
 *   val8·val9·val10·val13         →  국고채의 같은 순서
 *   <val4 /> 같은 빈칸            →  null
 *
 * 공개 API가 아니다. 화면(www.kofiabond.or.kr → 시가평가 → 채권시가평가수익률 → 기간별)이
 * 부르는 내부 서비스를 같은 모양으로 부른다. 인증키·쿠키는 필요 없다. CORS 헤더가 없어
 * 브라우저에서는 부를 수 없으므로 라우트에서만 쓴다(경계 규칙 6).
 *
 * 주의할 응답 (docs/plans/2026-09-28-jodal-wiheom-policy.md §4)
 *   - 본문은 XML이지만 Content-Type은 form-urlencoded다. 사이트 JS가 그렇게 보낸다.
 *   - 채권종류 하나에 7칸(나이스·한국·KIS·에프앤·이지·N사 평균·금투협). 두 번째 채권은 +7칸이다.
 *   - 평가일만 행으로 온다. 날짜 내림차순이지만 순서에 기대지 않는다(도메인이 고른다).
 *   - 오류도 HTTP 200이다. 헤더에 pfmResponseCode가 있으면 실패다.
 *   - 2023/01/09 전은 행은 오고 값이 빈칸이다. 빈칸은 null로 둔다 — 0이 아니다.
 */

import type { BondYieldSource, YieldFetch } from '@/application/ports';
import type { BondYield, DailyYields } from '@/domain/risk/funding-risk/funding-risk';
import { calendarDate, firstDayOf, lastDayOf, type CalendarDate } from '@/domain/shared/calendar-date';
import type { YearMonth } from '@/domain/shared/year-month';

const ENDPOINT = 'https://www.kofiabond.or.kr/proframeWeb/XMLSERVICES/';
const TIMEOUT_MS = 15_000;

/** 채권종류·잔존기간 코드(화면의 선택 상자 값). 공사채를 첫째 칸에 둔다 — 응답 칸 번호가 이 순서를 따른다. */
const PUBLIC_AAA = '3030110'; // 특수채/공사채 및 공단채/AAA
const TREASURY = '1010000'; // 국채/국고채권/양곡,외평,재정
const ONE_YEAR = '0100';
/** 평가사 평균('23.1.9~). 이 값일 때 기관 체크박스(val1~5)가 평균에 넣을 곳을 정한다. */
const AGENCY_AVERAGE = 'A20000';
const NICE = 'A10002';
const KOREA = 'A10003';
const KIS = 'A10004';

/** 응답의 칸 번호. 채권 하나에 7칸이고 두 번째 채권은 +7이다. */
const PUBLIC_AAA_COLUMNS = { 나이스피앤아이: 'val1', 한국자산평가: 'val2', KIS자산평가: 'val3', average: 'val6' } as const;
const TREASURY_COLUMNS = { 나이스피앤아이: 'val8', 한국자산평가: 'val9', KIS자산평가: 'val10', average: 'val13' } as const;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class KofiaYieldSource implements BondYieldSource {
  constructor(
    private readonly fetchImpl: Fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async dailyYields(month: YearMonth): Promise<YieldFetch> {
    try {
      const response = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: requestBody(compact(firstDayOf(month)), compact(lastDayOf(month))),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return { error: `HTTP ${response.status}` };
      return translate(await response.text(), this.now());
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** '2026/07/31' → '20260731' */
function compact(date: CalendarDate): string {
  return date.replaceAll('/', '');
}

/** 화면의 COMAjaxLibProframe.js(pfm_makeMsgXml)가 만드는 메시지와 같은 모양. 값은 모두 고정 코드와 날짜다. */
export function requestBody(from: string, to: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<message>
  <proframeHeader>
    <pfmAppName>BIS-KOFIABOND</pfmAppName>
    <pfmSvcName>BISBndSrtPrcSrchSO</pfmSvcName>
    <pfmFnName>selectTrm</pfmFnName>
  </proframeHeader>
  <systemHeader></systemHeader>
    <BISBndSrtPrcTrmDTO>
    <val31>${PUBLIC_AAA}</val31>
    <val32>${ONE_YEAR}</val32>
    <val33>${TREASURY}</val33>
    <val34>${ONE_YEAR}</val34>
    <creditEstOrgCd>${AGENCY_AVERAGE}</creditEstOrgCd>
    <standardDt1>${from}</standardDt1>
    <standardDt2>${to}</standardDt2>
    <val1>${NICE}</val1>
    <val2>${KOREA}</val2>
    <val3>${KIS}</val3>
    <val4></val4>
    <val5></val5>
</BISBndSrtPrcTrmDTO>
</message>
`;
}

function translate(xml: string, fetchedAt: Date): YieldFetch {
  const code = field(xml, 'pfmResponseCode');
  if (code !== null && code !== '') {
    return { error: `${code} ${field(xml, 'pfmResponseBasc') ?? ''}`.trim() };
  }

  const list = /<BISBndSrtPrcTrmListDTO>([\s\S]*?)<\/BISBndSrtPrcTrmListDTO>/.exec(xml)?.[1];
  if (list === undefined) return { error: '응답에 목록이 없습니다. 사이트의 응답 형식이 바뀌었을 수 있습니다.' };

  const rows = [...list.matchAll(/<BISBndSrtPrcTrmDTO>([\s\S]*?)<\/BISBndSrtPrcTrmDTO>/g)].map((m) => m[1]);
  const total = Number(field(list, 'dbio_total_count_'));
  if (!Number.isInteger(total) || total !== rows.length) {
    return { error: `전체 ${field(list, 'dbio_total_count_') ?? '?'}건이라는데 ${rows.length}건을 읽었습니다.` };
  }

  const days: DailyYields[] = [];
  for (const row of rows) {
    const date = dateOf(field(row, 'standardDt'));
    if (date === null) return { error: `평가일을 읽을 수 없습니다: ${field(row, 'standardDt') ?? '(없음)'}` };
    days.push({ date, publicAaa: bondOf(row, PUBLIC_AAA_COLUMNS), treasury: bondOf(row, TREASURY_COLUMNS) });
  }
  return { days, fetchedAt };
}

function bondOf(row: string, columns: typeof PUBLIC_AAA_COLUMNS | typeof TREASURY_COLUMNS): BondYield {
  return {
    average: rateOf(field(row, columns.average)),
    byAgency: {
      나이스피앤아이: rateOf(field(row, columns.나이스피앤아이)),
      한국자산평가: rateOf(field(row, columns.한국자산평가)),
      KIS자산평가: rateOf(field(row, columns.KIS자산평가)),
    },
  };
}

/**
 * 평평한 태그 하나의 글자. `<a>x</a>`면 'x', `<a />`면 '', 태그가 없으면 null.
 * 응답의 값은 숫자와 코드뿐이라 엔티티를 풀지 않는다.
 */
function field(xml: string, tag: string): string | null {
  const full = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  if (full !== null) return full[1].trim();
  return new RegExp(`<${tag}\\s*/>`).test(xml) ? '' : null;
}

/** 빈칸·'-' 같은 표기는 값이 없는 것이다. 0으로 채우지 않는다. */
function rateOf(text: string | null): number | null {
  if (text === null || text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function dateOf(text: string | null): CalendarDate | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text ?? '');
  if (match === null) return null;
  try {
    return calendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
  } catch {
    return null;
  }
}
