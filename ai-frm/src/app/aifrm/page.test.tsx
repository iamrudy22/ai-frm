import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AifrmDashboardPage from './page';

describe('보고서는 파일 산출 결과로만 연다', () => {
  it('초기 화면에는 보고서 진입 동작이나 결과 상태 없이 파일 등록을 제공한다', () => {
    const html = renderToStaticMarkup(<AifrmDashboardPage />);
    const hasReportEntry = /<button\b[^>]*id="report-entry"/.test(html);
    expect(hasReportEntry).toBe(false);
    expect(html).not.toMatch(/<h2\b[^>]*id="dashboard-results-heading"/);
    expect(html).not.toContain('aria-label="보고서 준비 상태"');
    expect(html).toMatch(/<input\b[^>]*type="file"[^>]*accept="\.xlsx,\.xls"[^>]*multiple=""/);
    const submit = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [])
      .find((button) => button.includes('산출하기'));
    expect(submit).toContain('disabled=""');
  });
});
