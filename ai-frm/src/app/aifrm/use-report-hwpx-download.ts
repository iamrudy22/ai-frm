'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinancialReport } from './report-model';

/** Downloads only an explicit click's document, independent of later screen changes. */
export function useReportHwpxDownload(report: FinancialReport | null) {
  const [isDownloadingHwpx, setIsDownloadingHwpx] = useState(false);
  const [hwpxDownloadError, setHwpxDownloadError] = useState<string | null>(null);
  const mounted = useRef(true);
  const active = useRef<AbortController | null>(null);
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    mounted.current = true;
    const pendingUrls = urls.current;
    return () => {
      mounted.current = false;
      active.current?.abort();
      active.current = null;
      for (const [url, timer] of pendingUrls) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      pendingUrls.clear();
    };
  }, []);

  const downloadHwpx = useCallback(async () => {
    if (!report || !mounted.current || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setIsDownloadingHwpx(true);
    setHwpxDownloadError(null);
    const live = () => mounted.current && !controller.signal.aborted;
    try {
      // Clone before the first await: changing the month cannot alter this export.
      const snapshot = structuredClone(report);
      const [{ collectReportHwpxAssets }, { exportReportHwpx }] = await Promise.all([
        import('./report-hwpx-assets'), import('./report-hwpx-export'),
      ]);
      if (!live()) return;
      const assets = await collectReportHwpxAssets(snapshot, controller.signal);
      if (!live()) return;
      const blob = await exportReportHwpx(snapshot, assets);
      if (!live()) return;
      const url = URL.createObjectURL(blob);
      const timer = setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }, 0);
      urls.current.set(url, timer);
      const anchor = document.createElement('a');
      try {
        anchor.href = url;
        const month = snapshot.reportMonth.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || '보고월';
        anchor.download = `재무위험관리보고서-${month}.hwpx`;
        document.body.appendChild(anchor);
        anchor.click();
      } finally { anchor.remove(); }
    } catch {
      if (live()) setHwpxDownloadError('한글(HWPX) 파일을 만들지 못했습니다. 다운로드를 다시 시도해 주세요.');
    } finally {
      if (active.current === controller) active.current = null;
      if (live()) setIsDownloadingHwpx(false);
    }
  }, [report]);

  return { downloadHwpx, isDownloadingHwpx, hwpxDownloadError };
}
