/** Browser-only output boundary: project the supplied snapshot and return a validated file. */
import type { FinancialReport } from './report-model';
import { projectReport, type ReportHwpxAssets } from './report-hwpx-document';
import { buildReportParts } from './report-hwpx-xml';
import { buildHwpxPackage, readHwpxPackage } from './report-hwpx-package';
export type { ReportHwpxAssets, ReportImageRole } from './report-hwpx-document';

export async function exportReportHwpx(report: FinancialReport, assets: ReportHwpxAssets): Promise<Blob> {
  const document = projectReport(report);
  const imageSnapshot = Object.fromEntries(Object.entries(assets).map(([role, bytes]) => [role, bytes.slice()])) as ReportHwpxAssets;
  const response = await fetch('/aifrm/hwpx/blank.hwpx', {
    mode: 'same-origin', credentials: 'same-origin', redirect: 'error',
  });
  if (!response.ok) throw new Error(`HWPX template loading failed (${response.status})`);
  const template = readHwpxPackage(new Uint8Array(await response.arrayBuffer()));
  const payload = buildHwpxPackage(buildReportParts(document, template, imageSnapshot));
  readHwpxPackage(payload);
  // A fresh ArrayBuffer also avoids SharedArrayBuffer-backed BlobPart type ambiguity.
  return new Blob([new Uint8Array(payload).buffer], { type: 'application/hwp+zip' });
}
