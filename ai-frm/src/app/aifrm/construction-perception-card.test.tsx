import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PerceptionReportDto } from '@/app/api/construction-perception/dto';
import { parseYearMonth as ym } from '@/domain/shared/year-month';
import { ConstructionPerceptionCard, fetchPerception, type Perception } from './construction-perception-card';
import { fetchFundingRisk, FundingRiskCard, type FundingRiskState } from './funding-risk-card';
import type { IndicatorRequestFailure } from './indicator-request';

// 합성 응답과 실제 Astryx 컴포넌트로 오류 복구 동선을 확인한다.
const noop = () => {};
function markup(overrides: Partial<Perception> = {}): string {
  const perception: Perception = {
    response: { ok: false, reason: '일시적으로 연결하지 못했습니다.' },
    isLoading: false,
    unreadable: null,
    choose: noop,
    reset: noop,
    retry: noop,
    selectedMonth: undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<ConstructionPerceptionCard perception={perception} />);
}

function button(html: string, label: string): string | undefined {
  return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find((item) => item.includes(label));
}

function unavailable(): PerceptionReportDto {
  return {
    basis: { baseMonth: ym('2026/06'), reportMonth: ym('2026/08'), source: '회차' },
    selectable: { from: ym('2026/05'), to: ym('2026/07') },
    result: { kind: 'unavailable', month: ym('2026/06'), missing: [{ key: '환율', reason: '지표 값 없음' }] },
    diagnostics: {
      indicators: [],
      ledger: { latestRound: ym('2026/08'), rounds: [ym('2026/05'), ym('2026/08')] },
      fetchedAt: '2026-10-21T00:00:00.000Z',
    },
  };
}

describe('건설경기 조회 실패 후 복구', () => {
  it('실패 사유와 같은 요청을 다시 불러오는 버튼을 함께 제공한다', () => {
    const html = markup();
    expect(html).toContain('일시적으로 연결하지 못했습니다.');
    expect(button(html, '다시 불러오기')).toBeDefined();
    expect(button(html, '다시 불러오기')).not.toContain('disabled');
    expect(html).not.toContain('건설경기 기준월');
    expect(html).not.toContain('기본값으로');
  });

  it('선택한 월의 요청이 실패해도 선택 월을 알리고 기본값으로 복귀할 수 있다', () => {
    const html = markup({ selectedMonth: ym('2026/07') });
    expect(html).toContain('요청 기준월 2026/07');
    expect(button(html, '기본값으로')).toBeDefined();
    expect(button(html, '기본값으로')).not.toContain('disabled');
    // 실패 응답에는 선택 가능한 월 범위가 없으므로 선택지를 만들지 않는다.
    expect(html).not.toContain('건설경기 기준월');
  });

  it('재시도 중에는 중복 재시도와 기본값 전환을 막고 진행 상태를 알린다', () => {
    const html = markup({ selectedMonth: ym('2026/07'), isLoading: true });
    expect(html).toContain('다시 불러오는 중');
    expect(button(html, '다시 불러오기')).toContain('disabled');
    expect(button(html, '기본값으로')).toContain('disabled');
  });

  it('지표 결측 응답에서도 파일을 다시 고르지 않고 재조회할 수 있다', () => {
    const html = markup({ response: { ok: true, value: unavailable() } });
    expect(html).toContain('지표 값 없음');
    expect(button(html, '다시 불러오기')).toBeDefined();
    expect(button(html, '다시 불러오기')).not.toContain('disabled');
  });
});

const requestFailures: readonly { failure: IndicatorRequestFailure; description: string }[] = [
  { failure: { kind: 'authentication', status: 401 }, description: '로그인 확인이 필요합니다.' },
  { failure: { kind: 'forbidden', status: 403 }, description: '접근이 거부되었습니다.' },
  { failure: { kind: 'redirect' }, description: '로그인 화면으로 이동했을 수 있습니다.' },
  { failure: { kind: 'unexpected-response', status: 200 }, description: '서버 응답을 읽지 못했습니다.' },
  { failure: { kind: 'http', status: 502 }, description: '서버 요청을 처리하지 못했습니다.' },
  { failure: { kind: 'network' }, description: '연결 상태와 로그인을 확인한 뒤 다시 불러오세요.' },
];

describe('지표 카드의 통신 실패 안내', () => {
  for (const { failure, description } of requestFailures) {
    it(`건설경기는 ${failure.kind}를 구분하고 선택한 월과 재시도 동선을 유지한다`, () => {
      const html = markup({
        response: { ok: false, reason: '서버에 연결하지 못했습니다.' },
        requestFailure: failure,
        selectedMonth: ym('2026/07'),
      });
      expect(html).toContain(description);
      expect(html).not.toContain('서버에 연결하지 못했습니다.');
      expect(html).toContain('요청 기준월 2026/07');
      expect(button(html, '다시 불러오기')).toBeDefined();
      expect(button(html, '다시 불러오기')).not.toContain('disabled');
    });

    it(`조달위험은 ${failure.kind}를 구분하고 수동 재시도 동선을 유지한다`, () => {
      const state: FundingRiskState = {
        response: { ok: false, reason: '서버에 연결하지 못했습니다.' },
        retry: noop,
        requestFailure: failure,
      };
      const html = renderToStaticMarkup(<FundingRiskCard fundingRisk={state} />);
      expect(html).toContain(description);
      expect(html).not.toContain('서버에 연결하지 못했습니다.');
      expect(button(html, '다시 불러오기')).toBeDefined();
      expect(button(html, '다시 불러오기')).not.toContain('disabled');
    });
  }

  it('업무 오류에는 서버에서 받은 기존 사유를 그대로 표시한다', () => {
    const html = renderToStaticMarkup(<FundingRiskCard fundingRisk={{
      response: { ok: false, reason: '선택한 월의 자료를 확인해 주세요.' },
      retry: noop,
    }} />);
    expect(html).toContain('선택한 월의 자료를 확인해 주세요.');
    expect(html).not.toContain('로그인 확인이 필요합니다.');
  });
});

describe('보고서 응답과 화면 전용 통신 실패의 분리', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('건설경기 인증 실패는 기존 보고서 사유와 별도로 반환한다', async () => {
    vi.stubGlobal('fetch', async () => new Response('SYNTHETIC_AUTH_DENIED', { status: 401 }));
    expect(await fetchPerception([])).toEqual({
      response: { ok: false, reason: '서버에 연결하지 못했습니다.' },
      requestFailure: { kind: 'authentication', status: 401 },
    });
  });

  it('조달위험 인증 실패는 기존 보고서 사유와 별도로 반환한다', async () => {
    vi.stubGlobal('fetch', async () => new Response('SYNTHETIC_AUTH_DENIED', { status: 401 }));
    expect(await fetchFundingRisk(ym('2026/01'))).toEqual({
      response: { ok: false, reason: '서버에 연결하지 못했습니다.' },
      requestFailure: { kind: 'authentication', status: 401 },
    });
  });

  it('건설경기 요청의 월·회차와 정상 산출불가 응답을 보존한다', async () => {
    const response = { ok: true, value: unavailable() };
    const request = vi.fn(async () => Response.json(response));
    vi.stubGlobal('fetch', request);
    expect(await fetchPerception([], ym('2026/03'), ym('2026/01'))).toEqual({
      response, requestFailure: null,
    });
    expect(request).toHaveBeenCalledWith('/api/construction-perception', expect.objectContaining({
      body: '{"rounds":[],"reportMonth":"2026/03","baseMonth":"2026/01"}',
    }));
  });

  it('조달위험 요청의 판단월과 서버 업무 오류를 보존한다', async () => {
    const response = { ok: false, reason: '선택한 월의 자료를 확인해 주세요.' };
    const request = vi.fn(async () => Response.json(response, { status: 400 }));
    vi.stubGlobal('fetch', request);
    expect(await fetchFundingRisk(ym('2026/01'))).toEqual({ response, requestFailure: null });
    expect(request).toHaveBeenCalledWith('/api/funding-risk', expect.objectContaining({
      body: '{"judgedMonth":"2026/01"}',
    }));
  });
});
