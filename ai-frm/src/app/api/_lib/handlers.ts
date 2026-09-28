/**
 * 라우트 처리 — 요청을 유스케이스에 넘기고 결과를 JSON으로 돌려준다.
 *
 * 규칙은 두지 않는다. 규칙은 도메인이, 순서는 유스케이스가 맡는다. 여기서는
 * 요청 본문을 값 객체로 바꾸고(검증은 팩토리가 한다) HTTP 상태를 고른다.
 *
 * route.ts가 정해진 이름(GET·POST)만 내보낼 수 있어서 처리 함수를 여기 두고
 * 테스트한다. route.ts는 조립한 의존성을 넘기기만 한다.
 */

import { assessPerception, type PerceptionRequest } from '@/application/construction-perception';
import { assessFundingRiskReport } from '@/application/funding-risk';
import type { BondYieldSource, EconomicIndicatorSource } from '@/application/ports';
import { ledgerOf, type ForecastLedger } from '@/domain/cashflow/forecast-ledger';
import { parseYearMonth, type YearMonth } from '@/domain/shared/year-month';

/**
 * POST { baseMonth?: 'YYYY/MM', reportMonth?: 'YYYY/MM', rounds?: 기재분[] }
 *
 * baseMonth는 사용자가 고른 기준월, reportMonth는 올린 최신 회차의 기준월이다.
 * rounds는 화면에서 올린 회차들의 기재분이다. 서버는 저장하지 않고 이 요청에만
 * 쓴다(2026-09-28). 자금수지표 원본은 오지 않는다.
 */
export async function handlePerception(request: Request, source: EconomicIndicatorSource): Promise<Response> {
  let perceptionRequest: PerceptionRequest;
  let ledger: ForecastLedger;
  try {
    const body = await readBody(request);
    perceptionRequest = {
      baseMonth: monthField(body, 'baseMonth'),
      reportMonth: monthField(body, 'reportMonth'),
    };
    ledger = ledgerOf((body.rounds ?? []) as unknown[]);
  } catch (e) {
    return Response.json({ ok: false, reason: e instanceof Error ? e.message : '본문이 올바르지 않습니다.' }, { status: 400 });
  }

  const out = await assessPerception(source, ledger, perceptionRequest);
  return Response.json(out, { status: out.ok ? 200 : 500 });
}

/**
 * POST { judgedMonth?: 'YYYY/MM' }
 *
 * judgedMonth는 판단월 = 올린 최신 회차의 달이다. 없으면 오늘이 속한 달로 판정한다.
 */
export async function handleFundingRisk(
  request: Request,
  yields: BondYieldSource,
  now?: () => Date,
): Promise<Response> {
  let judgedMonth: YearMonth | undefined;
  try {
    judgedMonth = monthField(await readBody(request), 'judgedMonth');
  } catch (e) {
    return Response.json({ ok: false, reason: e instanceof Error ? e.message : '본문이 올바르지 않습니다.' }, { status: 400 });
  }

  const out = await assessFundingRiskReport(yields, { judgedMonth }, now);
  return Response.json(out, { status: out.ok ? 200 : 500 });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error('본문이 JSON이 아닙니다.');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('본문은 객체여야 합니다.');
  return body as Record<string, unknown>;
}

function monthField(body: Record<string, unknown>, name: string): YearMonth | undefined {
  const value = body[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${name}은(는) YYYY/MM 문자열이어야 합니다.`);
  return parseYearMonth(value);
}
