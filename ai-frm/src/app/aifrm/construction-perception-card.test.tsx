import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PerceptionReportDto } from '@/app/api/construction-perception/dto';
import { parseYearMonth as ym } from '@/domain/shared/year-month';
import { ConstructionPerceptionCard, type Perception } from './construction-perception-card';

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
