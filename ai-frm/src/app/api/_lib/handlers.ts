/**
 * 라우트 처리 — 요청을 유스케이스에 넘기고 결과를 JSON으로 돌려준다.
 *
 * 규칙은 두지 않는다. 규칙은 도메인이, 순서는 유스케이스가 맡는다. 여기서는
 * 요청 본문을 기재분 값 객체로 바꾸고(검증은 팩토리가 한다) HTTP 상태를 고른다.
 *
 * route.ts가 정해진 이름(GET·POST)만 내보낼 수 있어서 처리 함수를 여기 두고
 * 테스트한다. route.ts는 조립한 의존성을 넘기기만 한다.
 */

import { assessPerception } from '@/application/construction-perception';
import type { EconomicIndicatorSource, ForecastLedgerRepository } from '@/application/ports';
import { recordRound } from '@/application/record-round';
import { roundEntry } from '@/domain/cashflow/round-entry';

export async function handlePerception(
  source: EconomicIndicatorSource,
  repo: ForecastLedgerRepository,
): Promise<Response> {
  const out = await assessPerception(source, repo);
  return Response.json(out, { status: out.ok ? 200 : 500 });
}

export async function handleRecordRound(request: Request, repo: ForecastLedgerRepository): Promise<Response> {
  let entry;
  try {
    entry = roundEntry(await request.json());
  } catch (e) {
    const reason = e instanceof SyntaxError ? '본문이 JSON이 아닙니다.' : e instanceof Error ? e.message : '본문이 올바르지 않습니다.';
    return Response.json({ ok: false, reason }, { status: 400 });
  }
  const out = await recordRound(repo, entry);
  return Response.json(out, { status: out.ok ? 200 : 500 });
}
