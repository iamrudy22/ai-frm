export type IndicatorEndpoint = '/api/construction-perception' | '/api/funding-risk';

export type IndicatorRequestFailure = {
  readonly kind: 'authentication' | 'forbidden' | 'redirect' | 'unexpected-response' | 'http' | 'network';
  readonly status?: number;
};

export type IndicatorWireResponse = (
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: string }
) & { readonly [key: string]: unknown };

export type IndicatorRequestResult =
  | { readonly kind: 'response'; readonly response: IndicatorWireResponse }
  | { readonly kind: 'failure'; readonly failure: IndicatorRequestFailure };

/** 전송 경계만 판독한다. 업무 결과·계산 규칙·보고서 사유는 변경하지 않는다. */
export async function requestIndicator(
  endpoint: IndicatorEndpoint, body: unknown, request: typeof fetch = fetch,
): Promise<IndicatorRequestResult> {
  let response: Response;
  try {
    response = await request(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      cache: 'no-store', credentials: 'same-origin', redirect: 'manual',
    });
  } catch {
    return failed(endpoint, 'network');
  }
  if (response.status === 401) return failed(endpoint, 'authentication', 401);
  if (response.status === 403) return failed(endpoint, 'forbidden', 403);
  if (response.type === 'opaqueredirect' || response.redirected || (response.status >= 300 && response.status < 400)) {
    return failed(endpoint, 'redirect', response.status > 0 ? response.status : undefined);
  }
  const mediaType = (response.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/i.test(mediaType)) {
    return failed(endpoint, 'unexpected-response', response.status);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return failed(endpoint, 'unexpected-response', response.status);
  }
  if (!isWireResponse(value)) return failed(endpoint, 'unexpected-response', response.status);
  if (!response.ok && value.ok) return failed(endpoint, 'http', response.status);
  return { kind: 'response', response: value };
}

function isWireResponse(value: unknown): value is IndicatorWireResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!('ok' in value)) return false;
  if (value.ok === false) return 'reason' in value && typeof value.reason === 'string';
  return value.ok === true && 'value' in value && typeof value.value === 'object' && value.value !== null && !Array.isArray(value.value);
}

function failed(
  endpoint: IndicatorEndpoint, kind: IndicatorRequestFailure['kind'], status?: number,
): IndicatorRequestResult {
  const failure: IndicatorRequestFailure = status === undefined ? { kind } : { kind, status };
  // 정적 경로와 분류만 기록한다. 본문·예외·응답 URL·인증정보는 로그에 넣지 않는다.
  console.warn(`AIFRM_INDICATOR_REQUEST_FAILED ${JSON.stringify({ endpoint, ...failure })}`);
  return { kind: 'failure', failure };
}

const descriptions: Readonly<Record<IndicatorRequestFailure['kind'], string>> = {
  authentication: '로그인 확인이 필요합니다. 새 탭에서 공유 주소에 로그인한 뒤 다시 불러오세요.',
  forbidden: '접근이 거부되었습니다. 허용된 계정인지 확인해 주세요.',
  redirect: '로그인 화면으로 이동했을 수 있습니다. 새 탭에서 로그인을 확인한 뒤 다시 불러오세요.',
  'unexpected-response': '서버 응답을 읽지 못했습니다. 잠시 후 다시 불러오세요.',
  http: '서버 요청을 처리하지 못했습니다. 잠시 후 다시 불러오세요.',
  network: '요청을 완료하지 못했습니다. 연결 상태와 로그인을 확인한 뒤 다시 불러오세요.',
};

/** UI 안내 전용. API DTO나 보고서의 reason으로 사용하지 않는다. */
export function indicatorFailureDescription(failure: IndicatorRequestFailure): string {
  return descriptions[failure.kind];
}
