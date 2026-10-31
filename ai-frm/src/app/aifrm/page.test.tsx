import { describe, expect, it, vi } from 'vitest';
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
    expect(html).not.toContain('aria-label="외부 위험 이력 보완"');
    expect(html).not.toContain('aria-label="월별 확정 이력"');
    expect(html).toContain('월별 리스크 보고서를');
    expect(html).not.toContain('엑셀 없이 직접 입력');
    expect(html).toContain('과거 자료 등록');
    expect(html).toContain('role="tablist"');
    expect(html).not.toContain('새 보고서 직접 입력');
    const submit = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [])
      .find((button) => button.includes('산출하기'));
    expect(submit).toBeUndefined();
  });
  it('작성 영역에는 빈 확정 이력이나 과거 보완 작업을 먼저 펼치지 않는다', () => {
    const html = renderToStaticMarkup(<AifrmDashboardPage />);
    expect(html).not.toContain('확정된 보고서가 없습니다');
    expect(html).not.toContain('보완 준비 확인');
    expect(html).not.toContain('보고월을 선택하고 원자료를 직접 입력해 첫 보고서');
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

it.each([
  { name: '확정본 조회 중 탭 이동에 성공하면 늦은 응답이 선택한 작업을 덮지 않는다', transition: 'allow' },
  { name: '저장 가드가 탭 이동을 거절하면 원래 확정본 조회는 정상 완료된다', transition: 'reject' },
  { name: '작업 전환이 없으면 확정본 응답이 기존 문서 화면으로 정상 연결된다', transition: 'none' },
])('$name', async ({ transition }) => {
  // Execute the page's real navigation callbacks; only React storage and remote hooks are isolated.
  vi.resetModules();
  const states: unknown[] = [], refs: { current: unknown }[] = [];
  let stateIndex = 0, refIndex = 0;
  const state = (initial: unknown) => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [states[index], (next: unknown) => { states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(states[index]) : next; }];
  };
  vi.doMock('react', async original => ({
    ...await original<typeof import('react')>(),
    useState: state,
    useReducer: (reduce: (value: unknown, action: unknown) => unknown, initial: unknown) => {
      const [value, update] = state(initial);
      return [value, (action: unknown) => (update as (next: unknown) => void)((previous: unknown) => reduce(previous, action))];
    },
    useRef: (initial: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (callback: unknown) => callback,
    useEffect: () => {},
  }));
  const downloadHwpx = vi.fn();
  const downloads = vi.fn(() => ({ downloadHwpx, isDownloadingHwpx: true, hwpxDownloadError: '합성 다운로드 오류' }));
  vi.doMock('./use-report-hwpx-download', () => ({ useReportHwpxDownload: downloads }));
  const cancelBackfill = vi.fn();
  vi.doMock('./construction-perception-card', async original => ({ ...await original<typeof import('./construction-perception-card')>(), usePerception: () => ({ response: null, isLoading: false, selectedMonth: undefined }) }));
  vi.doMock('./funding-risk-card', async original => ({ ...await original<typeof import('./funding-risk-card')>(), useFundingRisk: () => ({ response: null }) }));
  vi.doMock('./use-report-history', () => ({ useReportHistory: () => ({ view: null, running: false, cancel: cancelBackfill }) }));
  vi.stubGlobal('window', { scrollTo: vi.fn() });
  vi.stubGlobal('document', { getElementById: () => null });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1; });
  let acknowledge!: (response: Response) => void;
  const request = vi.fn(() => new Promise<Response>(resolve => { acknowledge = resolve; }));
  vi.stubGlobal('fetch', request);
  try {
    const { default: Page } = await import('./page');
    type Element = { type: unknown; props: Record<string, unknown> };
    let owner!: Element;
    const render = () => {
      stateIndex = refIndex = 0;
      owner = Page() as Element;
      return (owner.props.render as (slots: { entry: null; pending: null }) => Element)({ entry: null, pending: null });
    };
    const allElements = (value: unknown): Element[] => Array.isArray(value) ? value.flatMap(allElements)
      : value && typeof value === 'object' && 'props' in value ? [value as Element, ...Object.values((value as Element).props).flatMap(allElements)] : [];
    let home = render();
    expect(downloads).toHaveBeenLastCalledWith(null);
    (home.props.onNavigate as (section: string) => void)('history');
    await Promise.resolve();
    home = render();
    expect(home.props.section).toBe('history');
    const records = allElements(home.props.records).find(element => typeof element.type === 'function' && element.type.name === 'ReportCorrectionControls')!;
    (records.props.onOpen as (id: string) => void)('synthetic-confirmation');
    expect(request).toHaveBeenCalledWith('/api/report-history/confirmations?confirmationId=synthetic-confirmation', { cache: 'no-store' });
    if (transition === 'reject') (owner.props.registerNavigationGuard as (guard: () => Promise<boolean>) => void)(async () => false);
    if (transition !== 'none') (home.props.onNavigate as (section: string) => void)('create');
    await vi.waitFor(() => expect(render().props.section).toBe(transition === 'allow' ? 'create' : 'history'));
    acknowledge(new Response(JSON.stringify({ document: { json: { title: '합성 확정본' } }, historySources: {} }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await vi.waitFor(() => expect(request).toHaveResolved());
    await Promise.resolve();
    const view = render();
    if (transition === 'allow') {
      expect(view.props.section).toBe('create');
      expect(cancelBackfill).not.toHaveBeenCalled();
    } else {
      const report = allElements(view).find(element => typeof element.type === 'function' && element.type.name === 'FinancialReportPreview');
      expect(report?.props.report).toEqual({ title: '합성 확정본' });
      expect(downloads).toHaveBeenLastCalledWith(report?.props.report);
      expect(report?.props.onDownloadHwpx).toBe(downloadHwpx);
      expect(report?.props.isDownloadingHwpx).toBe(true);
      expect(report?.props.hwpxDownloadError).toBe('합성 다운로드 오류');
      expect(cancelBackfill).toHaveBeenCalledTimes(1);
    }
  } finally {
    for (const mockPath of ['react', './construction-perception-card', './funding-risk-card', './use-report-history', './use-report-hwpx-download']) vi.doUnmock(mockPath);
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
