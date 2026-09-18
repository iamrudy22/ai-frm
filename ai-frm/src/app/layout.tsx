import type { Metadata } from 'next';
import { ThemeProvider } from './ThemeProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIFRM — 월별 자금 리스크 모니터링',
  description: '자금수지표에서 대금 회수 위험과 유동성 Gap 등급을 판정합니다.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" data-astryx-theme="my-theme">
      <body className="h-full antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
