'use client';

import type { FinancialReport } from './report-model';
import type { ReportHwpxAssets, ReportImageRole } from './report-hwpx-document';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { VStack } from '@astryxdesign/core/VStack';
import { DocumentThemeProvider } from '../ThemeProvider';
import { ReportChart } from './report-chart';
import referenceRisk from './assets/reference-risk-criteria.png';
import referenceLcr from './assets/reference-lcr-formula.png';

type ChartRole = Exclude<ReportImageRole, 'referenceRisk' | 'referenceLcr'>;
export type HwpxCaptureSession = {
  capture: (role: ChartRole) => Promise<Uint8Array>;
  close: () => void;
};
type ReadReference = (role: 'referenceRisk' | 'referenceLcr') => Promise<Uint8Array>;
const CHART_ROLES: readonly ChartRole[] = ['recovery', 'liquidity', 'construction', 'funding', 'cash'];
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(new DOMException('다운로드가 취소되었습니다.', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('다운로드가 취소되었습니다.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function copyPng(bytes: Uint8Array): Uint8Array {
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) throw new Error('보고서 PNG 이미지를 생성하지 못했습니다.');
  return bytes.slice();
}

/** Output ports keep resource ownership and cancellation testable without page DOM. */
export async function collectAssetBytes(session: HwpxCaptureSession, read: ReadReference, signal?: AbortSignal): Promise<ReportHwpxAssets> {
  try {
    const parts = {} as Record<ReportImageRole, Uint8Array>;
    for (const role of CHART_ROLES) {
      signal?.throwIfAborted();
      parts[role] = copyPng(await abortable(session.capture(role), signal));
    }
    for (const role of ['referenceRisk', 'referenceLcr'] as const) {
      signal?.throwIfAborted();
      parts[role] = copyPng(await abortable(read(role), signal));
    }
    return parts;
  } finally { session.close(); }
}

export function HwpxChartFigures({ report }: { report: FinancialReport }) {
  return <VStack gap={0} width="100%" className="report-root report-sheet text-report-ink">
    {CHART_ROLES.map(role => {
      const metric = report.metrics.find(item => item.id === role);
      if (!metric) throw new Error('보고서 지표가 누락되었습니다.');
      const unavailable = metric.status === '산출 불가' || metric.status === '산출 중';
      const characters = Array.from(metric.narrative);
      // Same output-only abbreviation used by the existing PDF preview.
      const rendered = unavailable && characters.length > 60
        ? { ...metric, narrative: `${characters.slice(0, 59).join('')}… (상세는 HTML 참고)` } : metric;
      return <VStack gap={1} width="100%" className="report-metric-chart" data-hwpx-role={role} key={role}>
        <ReportChart metric={rendered}/>
      </VStack>;
    })}
  </VStack>;
}

/** Read existing print rules; apply only chart selectors beneath this temporary host. */
function chartPrintStyles(prefix: string): string {
  const output: string[] = [];
  const walk = (rules: CSSRuleList, printing = false) => {
    for (const rule of Array.from(rules)) {
      if ('selectorText' in rule && printing) {
        const style = rule as CSSStyleRule;
        const selectors = style.selectorText.split(',').map(value => value.trim()).filter(value =>
          value.includes('.report-chart') || value.includes('.report-metric-chart') || value === '.report-sheet .astryx-stack');
        if (selectors.length) output.push(`${selectors.map(selector => `${prefix} ${selector}`).join(',')}{${style.style.cssText}}`);
      } else if ('cssRules' in rule) {
        const media = 'media' in rule ? (rule as CSSMediaRule).media : null;
        walk((rule as CSSGroupingRule).cssRules, printing || Boolean(media && Array.from(media).includes('print')));
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try { walk(sheet.cssRules); } catch (error) {
      if (!(error instanceof DOMException && error.name === 'SecurityError')) throw error;
    }
  }
  if (!output.length) throw new Error('보고서 인쇄 스타일을 불러오지 못했습니다. 화면을 새로고침하고 다시 시도하세요.');
  return output.join('\n');
}

/** Freeze each SVG descendant too: html-to-image deep-clones SVG without doing that. */
function freezeFigure(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...Array.from(source.querySelectorAll('*'))];
  const copies = [clone, ...Array.from(clone.querySelectorAll('*'))];
  originals.forEach((element, index) => {
    const target = copies[index] as HTMLElement | SVGElement;
    const style = window.getComputedStyle(element);
    for (const name of Array.from(style)) target.style.setProperty(name, style.getPropertyValue(name), style.getPropertyPriority(name));
  });
  return clone;
}

let hostSequence = 0;
export async function collectReportHwpxAssets(report: FinancialReport, signal?: AbortSignal): Promise<ReportHwpxAssets> {
  signal?.throwIfAborted();
  const { toBlob } = await abortable(import('html-to-image'), signal);
  signal?.throwIfAborted();
  const host = document.createElement('section');
  const key = `hwpx-${++hostSequence}`;
  host.dataset.hwpxCapture = key;
  host.setAttribute('aria-hidden', 'true');
  host.className = 'print:hidden!';
  // Physical printable A4 width (210mm minus the unchanged 12mm side margins).
  Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '186mm', pointerEvents: 'none' });
  const style = document.createElement('style');
  style.textContent = chartPrintStyles(`[data-hwpx-capture="${key}"]`);
  host.append(style);
  const mount = document.createElement('section');
  host.append(mount);
  document.body.append(host);
  const root = createRoot(mount);
  let closed = false;
  const close = () => { if (closed) return; closed = true; root.unmount(); host.remove(); };
  try {
    flushSync(() => root.render(<DocumentThemeProvider><HwpxChartFigures report={report}/></DocumentThemeProvider>));
    await abortable(document.fonts.ready, signal);
    return await collectAssetBytes({ close, capture: async role => {
      const figure = mount.querySelector<HTMLElement>(`[data-hwpx-role="${role}"] > figure.report-chart`);
      if (!figure || figure.offsetWidth <= 0 || figure.offsetHeight <= 0) throw new Error('보고서 차트를 준비하지 못했습니다.');
      const width = Math.ceil(figure.getBoundingClientRect().width);
      const height = Math.ceil(figure.getBoundingClientRect().height);
      const clone = freezeFigure(figure);
      mount.append(clone);
      try {
        // System fallback fonts match the current report; disable stylesheet font scans.
        const blob = await abortable(toBlob(clone, { width, height, pixelRatio: 2, fontEmbedCSS: '',
          backgroundColor: window.getComputedStyle(figure).getPropertyValue('--astryx-theme-my-theme-report-paper').trim() }), signal);
        if (!blob || blob.type !== 'image/png' || !blob.size) throw new Error('보고서 PNG 이미지를 생성하지 못했습니다.');
        return new Uint8Array(await blob.arrayBuffer());
      } finally { clone.remove(); }
    } }, async role => {
      const response = await fetch((role === 'referenceRisk' ? referenceRisk : referenceLcr).src, { signal });
      if (!response.ok) throw new Error('보고서 참고표를 불러오지 못했습니다. 다시 시도하세요.');
      return new Uint8Array(await response.arrayBuffer());
    }, signal);
  } finally { close(); }
}
