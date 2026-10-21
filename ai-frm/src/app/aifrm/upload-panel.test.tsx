import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
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

function markup(prepared: PreparedUpload = { kind: 'empty' }, isApplied = false, files: File[] = []): string {
  return renderToStaticMarkup(<UploadPanel files={files} prepared={prepared} isApplied={isApplied}
    onFilesChange={() => {}} onSubmit={() => {}} />);
}

function row(html: string, label: string): string {
  return (html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? []).find((item) => item.includes(label)) ?? '';
}

function submitButton(html: string): string {
  return (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((button) => button.includes('산출하기')) ?? '';
}

function status(html: string, label: string): string {
  return html.match(new RegExp(`<[^>]+role="status"[^>]*aria-label="${label}"[^>]*>([^<]*)</[^>]+>`))?.[1] ?? '';
}

describe('기준월을 자동 인식하는 파일 등록', () => {
  it('선택 전에는 파일별 상대 시점과 용도를 보이고 수동 기준월 입력 없이 산출을 기다린다', () => {
    const html = markup();
    expect(row(html, '기준월 자금수지표')).toContain('Gap·시재 산출과 직전월 분양회수 실적');
    expect(row(html, '1개월 전 자금수지표')).toContain('직전월 대금 회수율 계산에 쓰는 계획값');
    expect(row(html, '3개월 전 자금수지표')).toContain('건설경기 지수에 쓰는 분양회수 계획');
    expect(row(html, '6개월 전 자금수지표')).toContain('해당 회차의 Gap·시재와 회수율 추이 보완');
    expect(html.match(/<li\b/g)).toHaveLength(7);
    expect(status(html, '자금수지표 기준월 확인')).toContain('업로드한 파일에서 자동으로');
    expect(submitButton(html)).toContain('disabled=""');
    expect(html).not.toMatch(/<select\b|role="combobox"|<details\b/);
    expect(html).not.toContain('차트 기준 자세히');
  });

  it('최신 회차를 기준으로 실제 년월과 해당 파일을 짝지어 부족한 파일을 구별한다', () => {
    const html = markup(ready(['2026/08', '2026/05', '2026/07']));
    expect(status(html, '자금수지표 기준월 확인')).toBe('자금수지표 기준월: 2026년 8월 · 최신 파일 기준');
    expect(row(html, '기준월 자금수지표')).toContain('2026년 8월 · synthetic-2026-8.xlsx');
    expect(row(html, '1개월 전 자금수지표')).toContain('2026년 7월 · synthetic-2026-7.xlsx');
    expect(row(html, '3개월 전 자금수지표')).toContain('2026년 5월 · synthetic-2026-5.xlsx');
    expect(row(html, '2개월 전 자금수지표')).toContain('2026년 6월');
    expect(row(html, '2개월 전 자금수지표')).toContain('파일 필요');
    expect(row(html, '2개월 전 자금수지표')).not.toContain('synthetic-');
    expect(status(html, '자료 준비 요약')).toBe('기본 회차 충족 · 최근 6개월 회수율 자료 최대 1개월분');
    expect(submitButton(html)).not.toContain('disabled=""');
  });

  it('연도가 바뀌어도 기준월에서 상대 회차의 년월을 정확하게 표시한다', () => {
    const html = markup(ready(['2025/10', '2025/12', '2026/01']));
    expect(row(html, '기준월 자금수지표')).toContain('2026년 1월');
    expect(row(html, '1개월 전 자금수지표')).toContain('2025년 12월 · synthetic-2025-12.xlsx');
    expect(row(html, '3개월 전 자금수지표')).toContain('2025년 10월 · synthetic-2025-10.xlsx');
    expect(row(html, '6개월 전 자금수지표')).toContain('2025년 7월');
  });

  it('기본 회차가 부족해도 판독이 끝나면 확보한 자료로 산출할 수 있다', () => {
    const html = markup(ready(['2026/08']));
    expect(status(html, '자료 준비 요약')).toContain('기본 산출용 파일 부족');
    expect(row(html, '1개월 전 자금수지표')).toContain('파일 필요');
    expect(row(html, '3개월 전 자금수지표')).toContain('파일 필요');
    expect(submitButton(html)).not.toContain('disabled=""');
  });

  it('오래된 회차가 추가되어도 회수율 추이 자료는 최근 여섯 개 연속 쌍까지만 안내한다', () => {
    const html = markup(ready(['2025/12', '2026/01', '2026/02', '2026/03', '2026/04', '2026/05', '2026/06', '2026/07', '2026/08']));
    expect(status(html, '자료 준비 요약')).toBe('기본 회차 충족 · 최근 6개월 회수율 자료 최대 6개월분');
    expect(html).toContain('항목 판독·외부 자료');
    expect(html).not.toContain('모든 지표 산출 가능');
  });

  it('일곱 회차 범위 밖에 추가 등록한 자료도 년월과 파일명을 확인할 수 있다', () => {
    const html = markup(ready(['2025/12', '2026/01', '2026/02', '2026/03', '2026/04', '2026/05', '2026/06', '2026/07', '2026/08']));
    expect(html).toContain('추가로 등록한 회차');
    expect(row(html, '2025년 12월 자금수지표')).toContain('synthetic-2025-12.xlsx');
    expect(row(html, '2026년 1월 자금수지표')).toContain('synthetic-2026-1.xlsx');
    expect(html.match(/<li\b/g)).toHaveLength(9);
    expect(markup(ready(['2026/02', '2026/08']))).not.toContain('추가로 등록한 회차');
  });

  it.each([
    { label: '읽는 중', prepared: { kind: 'reading', done: 1, total: 3 } as const, summary: '파일 읽는 중 1/3' },
    { label: '판독 오류', prepared: { kind: 'error', reason: '합성 파일 판독 실패' } as const, summary: '파일 내용을 확인해 다시 선택하세요' },
    { label: '선택 해제', prepared: { kind: 'empty' } as const, summary: '파일을 선택하세요' },
  ])('$label 상태에는 이전 기준월을 노출하지 않고 산출을 막는다', ({ prepared, summary }) => {
    const html = markup(prepared, true);
    expect(status(html, '자료 준비 요약')).toBe(summary);
    expect(html).not.toContain('최신 파일 기준');
    expect(html).not.toContain('파일 확인');
    expect(submitButton(html)).toContain('disabled=""');
    if (prepared.kind === 'error') {
      expect(html).toContain('aria-invalid="true"');
      expect(html).not.toContain(prepared.reason);
    }
  });

  it('이미 적용한 파일은 중복 산출을 막되 선택 파일명과 내장 선택 해제를 제공한다', () => {
    const files = [new File(['synthetic'], 'synthetic-2026-8.xlsx')];
    const html = markup(ready(['2026/08']), true, files);
    expect(submitButton(html)).toContain('disabled=""');
    expect(html).toContain('data-mode="dropzone"');
    expect(html).toMatch(/<input\b[^>]*type="file"[^>]*accept="\.xlsx,\.xls"[^>]*multiple=""/);
    expect(html).toContain('synthetic-2026-8.xlsx');
    expect(html).toMatch(/aria-label="Clear 자금수지표 파일"/);
  });

  it('산출에 적용한 파일은 닫힌 등록 영역에서 다시 펼쳐 파일과 용도를 확인할 수 있다', () => {
    const html = markup(ready(['2026/05', '2026/07', '2026/08']), true);
    const trigger = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [])
      .find((button) => button.includes('등록한 파일 확인·변경')) ?? '';
    expect(trigger).toContain('aria-expanded="false"');
    const contentId = trigger.match(/aria-controls="([^"]+)"/)?.[1];
    expect(contentId).toBeDefined();
    expect(html).toContain(`id="${contentId}"`);
    expect(row(html, '기준월 자금수지표')).toContain('synthetic-2026-8.xlsx');
    expect(row(html, '1개월 전 자금수지표')).toContain('직전월 대금 회수율 계산에 쓰는 계획값');
  });

  it.each([
    { kind: 'empty' } as const,
    { kind: 'reading', done: 0, total: 1 } as const,
    { kind: 'error', reason: '합성 판독 실패' } as const,
    ready(['2026/08']),
  ])('새 파일의 $kind 상태는 등록 영역을 접지 않아 파일 선택과 산출 준비가 드러난다', (prepared) => {
    const html = markup(prepared);
    expect(html).not.toContain('aria-expanded="false"');
    expect(html).toContain('data-mode="dropzone"');
    expect(row(html, '기준월 자금수지표')).not.toBe('');
  });
});
