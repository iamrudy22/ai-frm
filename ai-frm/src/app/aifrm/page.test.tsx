import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AifrmDashboardPage from './page';
import { ReportControlSurface } from './report-history-controls';

describe('보고서는 파일 산출 결과로만 연다', () => {
  it('초기 화면에는 보고서 진입 동작이나 결과 상태 없이 파일 등록을 제공한다', () => {
    const html = renderToStaticMarkup(<AifrmDashboardPage />);
    const hasReportEntry = /<button\b[^>]*id="report-entry"/.test(html);
    expect(hasReportEntry).toBe(false);
    expect(html).not.toMatch(/<h2\b[^>]*id="dashboard-results-heading"/);
    expect(html).not.toContain('aria-label="보고서 준비 상태"');
    expect(html).toMatch(/<input\b[^>]*type="file"[^>]*accept="\.xlsx,\.xls"[^>]*multiple=""/);
    expect(html).toContain('aria-label="외부 위험 이력 보완"');
    expect(html).toContain('aria-label="월별 확정 이력"');
    const submit = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [])
      .find((button) => button.includes('산출하기'));
    expect(submit).toContain('disabled=""');
  });
  it('확정 이력 제어부는 기존 인쇄 제외 클래스로 감싼다', () => {
    const html = renderToStaticMarkup(<AifrmDashboardPage />);
    expect(html).toMatch(/<section\b[^>]*class="[^"]*report-controls[^"]*"[^>]*aria-label="월별 확정 이력"/);
  });
});

it('보고서 바깥의 두 이력 제어부를 인쇄 제외되는 불투명 Astryx 표면에 놓는다', () => {
  const html = renderToStaticMarkup(<ReportControlSurface>
    <section aria-label="외부 위험 이력 보완">보완</section>
    <section aria-label="월별 확정 이력">확정</section>
  </ReportControlSurface>);
  expect(html).toMatch(/^<div\b[^>]*class="[^"]*astryx-card[^"]*report-controls[^"]*"[^>]*data-variant="default"/);
  expect(html).toContain('aria-label="외부 위험 이력 보완"');
  expect(html).toContain('aria-label="월별 확정 이력"');
});
