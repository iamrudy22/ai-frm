import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestIndicator } from './indicator-request';

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('지표 HTTP 요청의 실패 분류', () => {
  it('인증 거절의 일반 텍스트를 JSON으로 읽지 않고 인증 필요로 구분한다', async () => {
    const response = new Response('SYNTHETIC_AUTH_DENIED', {
      status: 401, headers: { 'content-type': 'text/plain' },
    });
    const actual = await requestIndicator('/api/construction-perception', { baseMonth: 123 }, async () => response);
    expect(actual).toEqual({ kind: 'failure', failure: { kind: 'authentication', status: 401 } });
    expect(response.bodyUsed).toBe(false);
  });

  it.each([401, 403])('빈 %i 응답도 본문 해석 없이 인증과 권한을 구분한다', async (status) => {
    const response = new Response(null, { status });
    const actual = await requestIndicator('/api/funding-risk', { judgedMonth: '2026/01' }, async () => response);
    expect(actual).toEqual({ kind: 'failure', failure: { kind: status === 401 ? 'authentication' : 'forbidden', status } });
    expect(response.bodyUsed).toBe(false);
  });

  it('HTML 접근 거부는 응답 형식 오류로 덮어쓰지 않는다', async () => {
    const response = new Response('<html>synthetic denied</html>', { status: 403, headers: { 'content-type': 'text/html' } });
    expect(await requestIndicator('/api/funding-risk', {}, async () => response))
      .toEqual({ kind: 'failure', failure: { kind: 'forbidden', status: 403 } });
    expect(response.bodyUsed).toBe(false);
  });

  it('동일 출처 POST의 입력과 수동 리디렉션 정책을 유지하며 자동 재시도하지 않는다', async () => {
    const sent: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const actual = await requestIndicator('/api/construction-perception', { rounds: [], reportMonth: '2026/01' }, async (input, init) => {
      sent.push({ input, init });
      return Response.json({ ok: false, reason: '합성 검증 오류' }, { status: 400 });
    });
    expect(actual).toEqual({ kind: 'response', response: { ok: false, reason: '합성 검증 오류' } });
    expect(sent).toEqual([{ input: '/api/construction-perception', init: {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{"rounds":[],"reportMonth":"2026/01"}', cache: 'no-store', credentials: 'same-origin', redirect: 'manual',
    } }]);
  });

  it('실제 HTTP 리디렉션의 본문과 이동 주소를 읽지 않는다', async () => {
    const response = Response.redirect('https://example.invalid/synthetic-login', 302);
    expect(await requestIndicator('/api/funding-risk', {}, async () => response))
      .toEqual({ kind: 'failure', failure: { kind: 'redirect', status: 302 } });
    expect(response.bodyUsed).toBe(false);
  });

  it('브라우저가 숨긴 리디렉션의 상태 0을 HTTP 오류로 해석하지 않는다', async () => {
    // Node의 Response는 opaque redirect를 직접 생성할 수 없어 브라우저 메타데이터 한 필드만 대체한다.
    const response = Response.error();
    Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
    expect(await requestIndicator('/api/funding-risk', {}, async () => response))
      .toEqual({ kind: 'failure', failure: { kind: 'redirect' } });
    expect(response.bodyUsed).toBe(false);
  });

  it('자동 이동을 거친 응답을 정상 지표 응답으로 사용하지 않는다', async () => {
    const response = Response.json({ ok: true, value: { synthetic: true } });
    Object.defineProperty(response, 'redirected', { value: true });
    expect(await requestIndicator('/api/funding-risk', {}, async () => response))
      .toEqual({ kind: 'failure', failure: { kind: 'redirect', status: 200 } });
    expect(response.bodyUsed).toBe(false);
  });

  it.each(['text/html', 'text/plain', 'application/octet-stream'])('%s 응답을 JSON으로 읽지 않는다', async (contentType) => {
    const response = new Response('SYNTHETIC_UNEXPECTED_BODY', { headers: { 'content-type': contentType } });
    expect(await requestIndicator('/api/construction-perception', {}, async () => response))
      .toEqual({ kind: 'failure', failure: { kind: 'unexpected-response', status: 200 } });
    expect(response.bodyUsed).toBe(false);
  });

  it('잘못된 JSON 응답은 실제 통신 실패와 구분한다', async () => {
    const response = new Response('{', { headers: { 'content-type': 'application/json' } });
    expect(await requestIndicator('/api/construction-perception', {}, async () => response))
      .toEqual({ kind: 'failure', failure: { kind: 'unexpected-response', status: 200 } });
  });

  it.each([null, [], {}, { ok: 'true' }, { ok: true }, { ok: true, value: null }, { ok: true, value: [] }, { ok: false }, { ok: false, reason: 1 }].map(body => ({ body })))(
    'JSON이어도 최상위 응답 계약을 만족하지 않으면 사용하지 않는다: $body', async ({ body }) => {
      expect(await requestIndicator('/api/funding-risk', {}, async () => Response.json(body)))
        .toEqual({ kind: 'failure', failure: { kind: 'unexpected-response', status: 200 } });
    },
  );

  it('정상 지표와 업무상 결측 결과 및 이력 메타데이터를 그대로 전달한다', async () => {
    const actual = await requestIndicator('/api/construction-perception', {}, async () => Response.json({
      ok: true, value: { result: { kind: 'unavailable', missing: [] } }, history: { captureStatus: 'failed', code: 'SYNTHETIC_STORAGE' },
    }));
    expect(actual).toEqual({ kind: 'response', response: {
      ok: true, value: { result: { kind: 'unavailable', missing: [] } }, history: { captureStatus: 'failed', code: 'SYNTHETIC_STORAGE' },
    } });
  });

  it.each([200, 400, 500])('HTTP %i의 기존 업무 오류 사유를 변경하지 않는다', async (status) => {
    expect(await requestIndicator('/api/funding-risk', {}, async () => Response.json({ ok: false, reason: '합성 업무 오류' }, { status })))
      .toEqual({ kind: 'response', response: { ok: false, reason: '합성 업무 오류' } });
  });

  it('표준 JSON 확장 미디어 타입의 업무 오류도 보존한다', async () => {
    const response = new Response('{"ok":false,"reason":"합성 업무 오류"}', {
      status: 400, headers: { 'content-type': 'application/problem+json; charset=utf-8' },
    });
    expect(await requestIndicator('/api/funding-risk', {}, async () => response))
      .toEqual({ kind: 'response', response: { ok: false, reason: '합성 업무 오류' } });
  });

  it('HTTP 실패 상태의 성공 JSON을 정상 지표로 사용하지 않는다', async () => {
    expect(await requestIndicator('/api/funding-risk', {}, async () => Response.json({ ok: true, value: {} }, { status: 500 })))
      .toEqual({ kind: 'failure', failure: { kind: 'http', status: 500 } });
  });

  it('첫 로그 메시지만 수집하는 브라우저에서도 안전한 실패 메타데이터를 읽을 수 있다', async () => {
    const actual = await requestIndicator('/api/construction-perception', {}, async () => new Response(null, { status: 401 }));
    expect(actual).toEqual({ kind: 'failure', failure: { kind: 'authentication', status: 401 } });
    const messages = vi.mocked(console.warn).mock.calls.map(([message]) => String(message));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^AIFRM_INDICATOR_REQUEST_FAILED \{/);
    expect(JSON.parse(messages[0].slice('AIFRM_INDICATOR_REQUEST_FAILED '.length))).toEqual({
      endpoint: '/api/construction-perception', kind: 'authentication', status: 401,
    });
  });

  it('인증 실패 로그에는 요청 값·응답 원문·주소·헤더를 남기지 않는다', async () => {
    const response = new Response('SYNTHETIC_BODY_MUST_NOT_LEAK', { status: 401, headers: { 'x-synthetic-private': 'PRIVATE_HEADER' } });
    Object.defineProperty(response, 'url', { value: 'https://example.invalid/?private=SYNTHETIC_QUERY' });
    const actual = await requestIndicator('/api/funding-risk', { memo: 'SYNTHETIC_INPUT_MUST_NOT_LEAK' }, async () => response);
    expect(actual).toEqual({ kind: 'failure', failure: { kind: 'authentication', status: 401 } });
    expect(vi.mocked(console.warn).mock.calls).toEqual([
      ['AIFRM_INDICATOR_REQUEST_FAILED {"endpoint":"/api/funding-risk","kind":"authentication","status":401}'],
    ]);
    expect(response.bodyUsed).toBe(false);
  });

  it('통신 예외 원문은 결과와 로그에 전달하지 않는다', async () => {
    const actual = await requestIndicator('/api/funding-risk', {}, async () => { throw new TypeError('SYNTHETIC_PRIVATE_EXCEPTION'); });
    expect(actual).toEqual({ kind: 'failure', failure: { kind: 'network' } });
    expect(vi.mocked(console.warn).mock.calls).toEqual([
      ['AIFRM_INDICATOR_REQUEST_FAILED {"endpoint":"/api/funding-risk","kind":"network"}'],
    ]);
  });
});
