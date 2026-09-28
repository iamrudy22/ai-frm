/**
 * ECOS ACL — 한국은행 Open API 응답을 도메인 언어로 끝까지 번역한다(DDD 검토 §10-4).
 *
 *   통계표 코드·항목 코드  →  지표 키(총수주액 …)
 *   TIME '202607'          →  달력 월 '2026/07'
 *   DATA_VALUE '14357324'  →  수
 *   UNIT_NAME '백만원 '     →  '백만원'
 *
 * 도메인과 화면은 ECOS 형식을 모른다. 서버 전용이다 — 인증키를 쓰므로 브라우저
 * 번들에 들어가면 안 된다(경계 규칙 6).
 *
 * 주의할 응답 (docs/plans/…-impl-plan.md §9, 인계 문서 §3·§4)
 *   - 오류도 HTTP 200으로 온다. 본문에 RESULT가 있으면 실패다.
 *   - "데이터 없음"의 실제 코드는 INFO-200이다(인계 문서의 ERROR-200과 다르다).
 *     그래서 앞머리가 아니라 번호로 가른다.
 *   - 한 번에 받는 건수를 넘으면 계열이 잘린다. 잘린 계열은 쓰지 않는다.
 */

import type { EconomicIndicatorSource, IndicatorFetch, SourceResult } from '@/application/ports';
import type { EcosIndicatorKey } from '@/domain/risk/construction-perception/construction-perception';
import { parseYearMonth, yearMonthOfDate, type YearMonth } from '@/domain/shared/year-month';

const API_BASE = 'https://ecos.bok.or.kr/api/StatisticSearch';
const START = '201501';
/** 2015/01부터 월별이면 1000건으로 80년을 넘게 받는다. */
const COUNT = 1000;
const TIMEOUT_MS = 25_000;

/** 인계 문서 §2에서 실제 호출로 검증한 코드. 비은행 대출금리는 지수에 쓰지 않아 뺐다. */
export const ECOS_SERIES: readonly { key: EcosIndicatorKey; stat: string; items: readonly string[] }[] = [
  { key: '총수주액', stat: '901Y020', items: ['I42A'] },
  { key: '주택매매가격지수', stat: '901Y062', items: ['P63A'] },
  { key: '미분양주택현황', stat: '901Y074', items: ['I410A'] },
  { key: '주택건설인허가실적', stat: '901Y105', items: ['ALL'] },
  { key: '설비투자지수', stat: '901Y066', items: ['I15B'] },
  { key: '대출금리', stat: '121Y006', items: ['BECBLA01'] },
  // 환율만 통화(원/미국달러)와 집계방식(평균자료) 두 항목을 지정한다.
  { key: '환율', stat: '731Y004', items: ['0000001', '0000100'] },
  { key: '주가', stat: '901Y014', items: ['1070000'] },
  { key: '선행지수순환변동치', stat: '901Y067', items: ['I16E'] },
];

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

type EcosRow = { TIME?: unknown; DATA_VALUE?: unknown; UNIT_NAME?: unknown };
type EcosBody = {
  StatisticSearch?: { list_total_count?: unknown; row?: EcosRow[] };
  RESULT?: { CODE?: unknown; MESSAGE?: unknown };
};

export class EcosIndicatorSource implements EconomicIndicatorSource {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: Fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetchAll(): Promise<SourceResult> {
    const key = this.apiKey?.trim();
    if (!key) {
      throw new Error('ECOS_API_KEY가 설정되지 않았습니다. ai-frm/.env.local에 넣으세요.');
    }
    const end = yearMonthOfDate(this.now()).replace('/', '');

    const entries = await Promise.all(
      ECOS_SERIES.map(async (s) => [s.key, await this.fetchOne(key, s.stat, s.items, end)] as const),
    );
    return Object.fromEntries(entries) as SourceResult;
  }

  private async fetchOne(key: string, stat: string, items: readonly string[], end: string): Promise<IndicatorFetch> {
    const url = [API_BASE, key, 'json', 'kr', '1', String(COUNT), stat, 'M', START, end, ...items.map(encodeURIComponent)].join('/');
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) return { error: `${stat}: HTTP ${response.status}` };
      return translate(stat, (await response.json()) as EcosBody, this.now());
    } catch (e) {
      // 네트워크 오류 메시지에 URL(=인증키)이 섞여 나오는 일이 없도록 지운다.
      const message = e instanceof Error ? e.message : String(e);
      return { error: `${stat}: ${message.split(key).join('***')}` };
    }
  }
}

function translate(stat: string, body: EcosBody, fetchedAt: Date): IndicatorFetch {
  if (body.RESULT !== undefined) {
    const code = String(body.RESULT.CODE ?? '');
    if (code.endsWith('-200')) return { values: new Map(), unit: '', fetchedAt };
    return { error: `${stat}: ${code} ${String(body.RESULT.MESSAGE ?? '')}`.trim() };
  }

  const rows = body.StatisticSearch?.row;
  if (!Array.isArray(rows)) return { error: `${stat}: 응답에 행이 없습니다.` };

  const total = Number(body.StatisticSearch?.list_total_count);
  if (Number.isFinite(total) && total > rows.length) {
    return { error: `${stat}: 전체 ${total}건 중 ${rows.length}건만 와서 계열이 잘렸습니다.` };
  }

  const values = new Map<YearMonth, number>();
  let unit = '';
  for (const row of rows) {
    const time = String(row.TIME ?? '');
    const month = parseYearMonth(`${time.slice(0, 4)}/${time.slice(4, 6)}`);
    const value = Number(row.DATA_VALUE);
    // 빈 값·'-' 같은 표기는 값이 없는 달이다. 0으로 채우지 않는다.
    if (row.DATA_VALUE === null || row.DATA_VALUE === '' || !Number.isFinite(value)) continue;
    values.set(month, value);
    unit = String(row.UNIT_NAME ?? '').trim();
  }
  return { values, unit, fetchedAt };
}
