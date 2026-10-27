import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Text } from '@astryxdesign/core/Text';
import * as workspace from './home-workspace';

const props = {
  section: 'create' as workspace.HomeSection,
  onNavigate: vi.fn(), onPast: vi.fn(),
  upload: <Text>파일 선택 영역</Text>,
  pending: <Text>1월 입력 중</Text>, records: <Text>7월 확정 보고서</Text>,
  entry: <Text>보고월별 원자료 입력</Text>, backfill: <Text>과거 자료로 외부 위험 보완</Text>,
};

describe('홈의 현재 작업에 맞는 정보 공개', () => {
  it('초기 작성에서는 업로드와 독립 과거 진입을 제공하고 이력·과거 입력 내용을 펼치지 않는다', () => {
    const html = renderToStaticMarkup(<workspace.HomeWorkspace {...props} />);
    expect(html).toContain('파일 선택 영역');
    expect(html).toContain('과거 자료 등록');
    expect(html).toContain('엑셀 없이 직접 입력');
    expect(html).not.toContain('1월 입력 중');
    expect(html).not.toContain('7월 확정 보고서');
    expect(html).not.toContain('보고월별 원자료 입력');
    expect(html).not.toContain('과거 자료로 외부 위험 보완');
  });
  it('보관 영역은 초안과 확정본을 제공하고 외부 위험 보완은 접힌 보조 작업으로 둔다', () => {
    const html = renderToStaticMarkup(<workspace.HomeWorkspace {...props} section="history" />);
    expect(html).toContain('1월 입력 중');
    expect(html).toContain('7월 확정 보고서');
    expect(html).toContain('과거 위험 이력 보완');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('파일 선택 영역');
  });
  it('과거 등록은 업로드나 확정본이 없어도 원자료 입력과 이어쓰기 목록을 제공한다', () => {
    const html = renderToStaticMarkup(<workspace.HomeWorkspace {...props} section="past" />);
    expect(html).toContain('보고월별 원자료 입력');
    expect(html).toContain('1월 입력 중');
    expect(html).not.toContain('파일 선택 영역');
    expect(html).not.toContain('7월 확정 보고서');
  });
  it('산출 후에는 결과를 먼저 제공하고 적용 파일·세부 내역을 뒤에 배치한다', () => {
    const html = renderToStaticMarkup(<workspace.HomeWorkspace {...props} results={<Text>4개 산출 결과</Text>} details={<Text>지표별 산출 내역</Text>} />);
    expect(html.indexOf('4개 산출 결과')).toBeLessThan(html.indexOf('파일 선택 영역'));
    expect(html.indexOf('파일 선택 영역')).toBeLessThan(html.indexOf('지표별 산출 내역'));
    expect(html).not.toContain('가지고 있는 자료를 올려주세요');
  });
});

describe('저장 후 화면 이동', () => {
  it('저장 ACK가 올 때까지 다음 목적지로 이동하지 않는다', async () => {
    const events: string[] = [];
    let acknowledge!: (value: boolean) => void;
    const operation = workspace.navigateAfterEditors([
      async () => { events.push('보관 요청'); return new Promise<boolean>(resolve => { acknowledge = resolve; }); },
      async () => { events.push('정정 종료'); return true; },
    ], () => events.push('화면 이동'));
    expect(events).toEqual(['보관 요청']);
    acknowledge(true);
    await expect(operation).resolves.toBe(true);
    expect(events).toEqual(['보관 요청', '정정 종료', '화면 이동']);
  });
  it('응답불명이나 충돌로 가드가 거절하면 현재 편집기를 유지한다', async () => {
    const navigate = vi.fn(); const nextGuard = vi.fn(async () => true);
    await expect(workspace.navigateAfterEditors([async () => false, nextGuard], navigate)).resolves.toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(nextGuard).not.toHaveBeenCalled();
  });
  it('보관이 실패하면 현재 편집기를 유지하고 실패를 외부로 누출하지 않는다', async () => {
    const navigate = vi.fn();
    await expect(workspace.navigateAfterEditors([async () => { throw Error('SAVE_UNAVAILABLE'); }], navigate)).resolves.toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('활성 편집기가 없으면 직접 이동할 수 있다', async () => {
    const navigate = vi.fn();
    await expect(workspace.navigateAfterEditors([null, null], navigate)).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
