import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { FileInput } from '@astryxdesign/core/FileInput';
import { ListItem } from '@astryxdesign/core/List';
import { createStatement } from '@/domain/cashflow/statement';
import { amount } from '@/domain/shared/amount';
import type { PreparedUpload } from './upload-session';
import { arrangeRounds } from './uploaded-rounds';
import { UploadPanel } from './upload-panel';

function ready(months: readonly string[]): PreparedUpload {
  const values = Array.from({ length: 12 }, () => amount(100));
  const arranged = arrangeRounds(months.map((month) => {
    const [year, number] = month.split('/').map(Number);
    return {
      file: `synthetic-${year}-${number}.xlsx`,
      statement: createStatement({
        asOf: new Date(year, number - 1, 10),
        monthLabels: Array.from({ length: 12 }, (_, index) => `${index + 1}월`),
        baseMonthIndex: number - 1,
        planYearEndIndex: 11,
        amounts: { 기초시재: values, 수입계: values, 수입: values, 분양회수: values, 기타수입: values, 지출: values },
      }),
    };
  }));
  if (!arranged.ok) throw new Error(arranged.reason);
  return { kind: 'ready', rounds: arranged };
}

type Props = Parameters<typeof UploadPanel>[0];
type Element = ReactElement<Record<string, unknown>>;
function panel(prepared: PreparedUpload = { kind: 'empty' }, overrides: Partial<Props> = {}) {
  const files = prepared.kind === 'ready' ? prepared.rounds.rounds.map(source => new File(['synthetic'], source.file)) : [];
  return UploadPanel({ files, prepared, isApplied: false, onFilesChange: () => {}, onSubmit: () => {}, ...overrides });
}
function elements(node: ReactNode, visibleOnly = false): Element[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    if (visibleOnly && child.type === Collapsible && (child.props.isOpen ?? child.props.defaultIsOpen) === false) return [child];
    return [child, ...['children', 'endContent', 'header', 'description'].flatMap(slot => elements(child.props[slot] as ReactNode, visibleOnly))];
  });
}
function disclosure(tree: ReactNode, label: string): Element | undefined {
  return elements(tree).find(element => element.type === Collapsible && element.props.trigger === label);
}
function visibleLabels(tree: ReactNode) {
  return elements(tree, true).filter(element => element.type === ListItem).map(element => element.props.label);
}
function submitButton(html: string) {
  return (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find(button => button.includes('산출하기')) ?? '';
}
function status(html: string, label: string) {
  return html.match(new RegExp(`<[^>]+role="status"[^>]*aria-label="${label}"[^>]*>([^<]*)</[^>]+>`))?.[1] ?? '';
}
function picker(tree: ReactNode) {
  const input = elements(tree).find(element => element.type === FileInput);
  if (!input) throw new Error('실제 FileInput이 필요합니다.');
  return input;
}
function press(tree: ReactNode, label: string) {
  const action = elements(tree).find(element => element.type === Button && element.props.label === label);
  if (!action) throw new Error(`동작 없음: ${label}`);
  (action.props.onClick as () => void)();
}

describe('필요한 시점에 설명하는 파일 등록', () => {
  it('선택 전에는 업로드를 먼저 제공하고 일곱 파일의 용도는 접힌 준비 안내에서 확인한다', () => {
    const tree = panel();
    const guide = disclosure(tree, '필요한 파일 안내');
    expect(guide?.props.defaultIsOpen).toBe(false);
    expect(visibleLabels(tree)).toEqual([]);
    const guideHtml = renderToStaticMarkup(guide?.props.children as ReactNode);
    expect(guideHtml.match(/<li\b/g)).toHaveLength(7);
    expect(guideHtml).toContain('Gap·시재 산출과 직전월 분양회수 실적');
    expect(guideHtml).toContain('직전월 대금 회수율 계산에 쓰는 계획값');
    expect(guideHtml).toContain('건설경기 지수에 쓰는 분양회수 계획');
    expect(guideHtml).toContain('해당 회차의 Gap·시재와 회수율 추이 보완');
    expect(picker(tree).props.mode).toBe('dropzone');
    expect(picker(tree).props.accept).toBe('.xlsx,.xls');
    expect(picker(tree).props.isMultiple).toBe(true);
    const html = renderToStaticMarkup(tree);
    expect(status(html, '자금수지표 기준월 확인')).toBe('');
    expect(picker(tree).props.placeholder).toBe('자금수지표를 놓거나 클릭하여 선택');
    expect(html).not.toContain('.xlsx · .xls / 여러 회차를 한 번에 선택');
    expect(elements(tree).filter(element => element.type === Button && element.props.label === '자금수지표 선택')).toHaveLength(0);
    expect(html).not.toMatch(/<select\b|role="combobox"/);
    expect(html).not.toContain('차트 기준 자세히');
  });

  it('파일 선택 전에는 중복된 선택 대기 안내와 비활성 산출 버튼을 늘어놓지 않는다', () => {
    const html = renderToStaticMarkup(panel());
    expect(submitButton(html)).toBe('');
    expect(status(html, '자료 준비 요약')).toBe('');
  });

  it('판독 후에는 등록 파일과 실제 부족한 기본 회차만 먼저 보여 주며 추이는 선택 설명으로 접는다', () => {
    const tree = panel(ready(['2026/08', '2026/07']));
    const html = renderToStaticMarkup(tree);
    expect(status(html, '자금수지표 기준월 확인')).toBe('자금수지표 기준월: 2026년 8월 · 최신 파일 기준');
    expect(visibleLabels(tree)).toEqual(['2026년 8월 자금수지표', '2026년 7월 자금수지표', '3개월 전 자금수지표']);
    expect(html).toContain('2026년 5월');
    expect(html).toContain('건설경기 지수에 쓰는 분양회수 계획');
    expect(disclosure(tree, '추이 보완 자료 · 선택')?.props.defaultIsOpen).toBe(false);
    expect(renderToStaticMarkup(disclosure(tree, '추이 보완 자료 · 선택')?.props.children as ReactNode)).toContain('항목 판독·외부 자료');
    expect(picker(tree).props.mode).toBe('input');
    expect(submitButton(html)).not.toContain('disabled=""');
  });

  it('기본 회차를 충족하면 불필요한 부족 안내 없이 등록한 실제 파일을 확인한다', () => {
    const tree = panel(ready(['2026/08', '2026/05', '2026/07']));
    const html = renderToStaticMarkup(tree);
    expect(visibleLabels(tree)).toEqual(['2026년 8월 자금수지표', '2026년 7월 자금수지표', '2026년 5월 자금수지표']);
    expect(html).toContain('synthetic-2026-8.xlsx');
    expect(html).toContain('synthetic-2026-7.xlsx');
    expect(html).toContain('synthetic-2026-5.xlsx');
    expect(status(html, '자료 준비 요약')).toBe('기본 회차 충족 · 최근 6개월 회수율 자료 최대 1개월분');
  });

  it('연도가 바뀐 최신 회차에서도 빠진 기본 회차의 년월을 상대 시점에 맞춰 안내한다', () => {
    const tree = panel(ready(['2026/01']));
    const html = renderToStaticMarkup(tree);
    expect(visibleLabels(tree)).toEqual(['2026년 1월 자금수지표', '1개월 전 자금수지표', '3개월 전 자금수지표']);
    expect(html).toContain('2025년 12월');
    expect(html).toContain('2025년 10월');
    const trend = disclosure(tree, '추이 보완 자료 · 선택');
    expect(renderToStaticMarkup(trend?.props.children as ReactNode)).toContain('2025년 7월');
  });

  it('기본 회차가 부족해도 판독이 끝나면 확보한 자료로 산출할 수 있다', () => {
    const tree = panel(ready(['2026/08']));
    const html = renderToStaticMarkup(tree);
    expect(status(html, '자료 준비 요약')).toContain('기본 산출용 파일 부족');
    expect(visibleLabels(tree)).toContain('1개월 전 자금수지표');
    expect(visibleLabels(tree)).toContain('3개월 전 자금수지표');
    expect(submitButton(html)).not.toContain('disabled=""');
  });

  it('오래된 추가 회차도 파일명으로 확인하고 회수율 안내는 최근 여섯 쌍으로 제한한다', () => {
    const tree = panel(ready(['2025/12', '2026/01', '2026/02', '2026/03', '2026/04', '2026/05', '2026/06', '2026/07', '2026/08']));
    const html = renderToStaticMarkup(tree);
    expect(status(html, '자료 준비 요약')).toBe('기본 회차 충족 · 최근 6개월 회수율 자료 최대 6개월분');
    expect(visibleLabels(tree)).toHaveLength(9);
    expect(html).toContain('synthetic-2025-12.xlsx');
    expect(html).toContain('synthetic-2026-1.xlsx');
    expect(html).toContain('항목 판독·외부 자료');
    expect(html).not.toContain('모든 지표 산출 가능');
  });

  it.each([
    { label: '읽는 중', prepared: { kind: 'reading', done: 1, total: 3 } as const, summary: '파일 읽는 중 1/3' },
    { label: '판독 오류', prepared: { kind: 'error', reason: '합성 파일 판독 실패' } as const, summary: '파일 내용을 확인해 다시 선택하세요' },
  ])('$label 상태는 이전 기준월을 노출하거나 등록 영역을 접지 않고 산출을 막는다', ({ prepared, summary }) => {
    const tree = panel(prepared, { isApplied: true });
    const html = renderToStaticMarkup(tree);
    expect(status(html, '자료 준비 요약')).toBe(summary);
    expect(html).not.toContain('최신 파일 기준');
    expect(disclosure(tree, '등록한 파일 확인·변경')).toBeUndefined();
    expect(submitButton(html)).toContain('disabled=""');
    if (prepared.kind === 'error') expect(html).toContain('aria-invalid="true"');
  });

  it('선택 해제 시 이전 기준월이나 비활성 산출 버튼을 보여 주지 않는다', () => {
    const tree = panel({ kind: 'empty' }, { isApplied: true });
    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain('최신 파일 기준');
    expect(disclosure(tree, '등록한 파일 확인·변경')).toBeUndefined();
    expect(submitButton(html)).toBe('');
  });

  it('적용된 파일은 닫힌 등록 영역에서 확인·변경할 수 있고 중복 산출을 막는다', () => {
    const tree = panel(ready(['2026/08']), { isApplied: true });
    expect(disclosure(tree, '등록한 파일 확인·변경')?.props.defaultIsOpen).toBe(false);
    expect(visibleLabels(tree)).toEqual([]);
    expect(submitButton(renderToStaticMarkup(tree))).toContain('disabled=""');
    expect(renderToStaticMarkup(tree)).toContain('synthetic-2026-8.xlsx');
  });

  it('새 판독 완료 상태는 적용 전까지 등록 파일과 산출 동작을 펼쳐 둔다', () => {
    const tree = panel(ready(['2026/08']));
    expect(disclosure(tree, '등록한 파일 확인·변경')).toBeUndefined();
    expect(visibleLabels(tree)).toContain('2026년 8월 자금수지표');
    expect(submitButton(renderToStaticMarkup(tree))).not.toContain('disabled=""');
  });

  it('추가 파일 선택은 기존 파일을 유지하고 정확히 같은 파일의 재선택만 중복 제외한다', () => {
    const first = new File(['first'], 'august.xlsx', { lastModified: 10 });
    const second = new File(['second'], 'july.xlsx', { lastModified: 20 });
    const same = new File(['first'], 'august.xlsx', { lastModified: 10 });
    const changed = vi.fn();
    const tree = panel(ready(['2026/08']), { files: [first], onFilesChange: changed });
    (picker(tree).props.onChange as (files: File[]) => void)([same, second]);
    expect(changed).toHaveBeenCalledWith([first, second]);
  });

  it('기존 원본을 재선택하지 않고 새 파일만 골라도 기존 원본을 함께 전달한다', () => {
    const first = new File(['first'], 'august.xlsx', { lastModified: 10 });
    const second = new File(['second'], 'july.xlsx', { lastModified: 20 });
    const changed = vi.fn();
    const tree = panel(ready(['2026/08']), { files: [first], onFilesChange: changed });
    (picker(tree).props.onChange as (files: File[]) => void)([second]);
    expect(changed).toHaveBeenCalledWith([first, second]);
  });

  it('다른 파일이 같은 회차여도 이름이나 내용 기준으로 조용히 덮어쓰지 않는다', () => {
    const first = new File(['first'], 'august.xlsx', { lastModified: 10 });
    const replacement = new File(['new version'], 'august.xlsx', { lastModified: 20 });
    const changed = vi.fn();
    const tree = panel(ready(['2026/08']), { files: [first], onFilesChange: changed });
    (picker(tree).props.onChange as (files: File[]) => void)([replacement]);
    expect(changed).toHaveBeenCalledWith([first, replacement]);
  });

  it('동명 파일도 지정한 원본 하나만 제외하고 마지막 파일 제외는 빈 선택을 전달한다', () => {
    const first = new File(['first'], 'same.xlsx', { lastModified: 10 });
    const second = new File(['second'], 'same.xlsx', { lastModified: 20 });
    const changed = vi.fn();
    press(panel(ready(['2026/08']), { files: [first, second], onFilesChange: changed }), 'same.xlsx · 1번째 파일 제외');
    expect(changed).toHaveBeenLastCalledWith([second]);
    press(panel(ready(['2026/08']), { files: [second], onFilesChange: changed }), 'same.xlsx · 1번째 파일 제외');
    expect(changed).toHaveBeenLastCalledWith([]);
  });

  it('추가 선택기의 취소는 기존 선택을 지우지 않는다', () => {
    const changed = vi.fn();
    const tree = panel(ready(['2026/08']), { onFilesChange: changed });
    (picker(tree).props.onChange as (files: null) => void)(null);
    expect(changed).not.toHaveBeenCalled();
  });
});
