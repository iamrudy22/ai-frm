'use client';

import { useEffect, type ReactNode } from 'react';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Theme } from '@astryxdesign/core/theme';
import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import type { YearMonth } from '@/domain/shared/year-month';
import { aifrmHomeTheme } from './aifrm-home';
import './home-theme.css';

export type HomeSection = 'create' | 'history' | 'past';
const koreanMessages = {
  '@astryx.appShell.skipToContent': { defaultMessage: '본문으로 이동' },
  '@astryx.dateInput.openCalendar': { defaultMessage: '달력 열기' },
  '@astryx.dateInput.toggleCalendarClose': { defaultMessage: '달력 닫기' },
  '@astryx.dialog.close': { defaultMessage: '닫기' },
  '@astryx.field.required': { defaultMessage: '필수' },
  '@astryx.field.optional': { defaultMessage: '선택' },
};
type Props = {
  readonly section: HomeSection;
  readonly onNavigate: (section: HomeSection) => void;
  readonly onPast: (trigger?: HTMLElement) => void;
  readonly upload: ReactNode;
  readonly selectedBase?: YearMonth | null;
  readonly notices?: ReactNode;
  readonly results?: ReactNode;
  readonly details?: ReactNode;
  readonly pending?: ReactNode;
  readonly records?: ReactNode;
  readonly entry?: ReactNode;
  readonly backfill?: ReactNode;
  readonly backfillRunning?: boolean;
};

function HomeFonts() {
  useEffect(() => {
    const font = new FontFace('Geist', 'url(/fonts/geist-latin.woff2)', { weight: '100 900', display: 'swap' });
    void font.load().then(loaded => document.fonts.add(loaded)).catch(() => { /* Keep the system fallback available. */ });
  }, []);
  return null;
}

/** Keep the current editor visible until every active owner acknowledges a safe exit. */
export async function navigateAfterEditors(
  guards: readonly ((() => Promise<boolean>) | null)[],
  navigate: () => void,
): Promise<boolean> {
  try {
    for (const guard of guards) if (guard && !await guard()) return false;
    navigate();
    return true;
  } catch { return false; }
}

/** Presentation only. Session owners stay outside this conditional content. */
export function HomeWorkspace({ section, onNavigate, onPast, upload, selectedBase, notices, results, details, pending, records, entry, backfill, backfillRunning = false }: Props) {
  const [year, month] = selectedBase?.split('/').map(Number) ?? [];
  return <InternationalizationProvider locale="ko" messages={{ ko: koreanMessages }}><Theme theme={aifrmHomeTheme} mode="light">
    <HomeFonts />
    <AppShell height="auto" variant="surface">
      <Layout contentWidth={960} height="auto" padding={6}
        header={<LayoutHeader paddingBlockEnd={0}>
          <VStack gap={6} paddingBlockStart={4}>
            <HStack gap={4} wrap="wrap" hAlign="between" vAlign="center">
              <VStack gap={1}>
                <Text type="label">AIFRM</Text>
                <Text type="supporting" color="secondary">월별 자금 리스크</Text>
              </VStack>
              <Button label="과거 자료 등록" variant="ghost" size="sm" aria-current={section === 'past' ? 'page' : undefined} onClick={event => onPast(event.currentTarget)} />
            </HStack>
            {section !== 'past' && <TabList value={section} onChange={value => onNavigate(value as HomeSection)}
              role="tablist" hasDivider aria-label="보고서 작업">
              <Tab value="create" label="보고서 작성" panelId="workspace-create" />
              <Tab value="history" label="보관한 보고서" panelId="workspace-history" />
            </TabList>}
          </VStack>
        </LayoutHeader>}
        content={<LayoutContent isScrollable={false} padding={0}>
          <VStack gap={6} paddingInline={6} paddingBlockStart={10} paddingBlockEnd={10}>
            {section === 'create' ? <VStack id="workspace-create" role="tabpanel" aria-label="보고서 작성" gap={6}>
              {notices}
              {results ? <>{results}{upload}{details}</> : <>
                <VStack gap={4}>
                  {selectedBase ? <>
                    <Heading level={1} id="workspace-heading" tabIndex={-1}>{`${year}년 ${month}월 자료를 확인했습니다`}</Heading>
                    <Text color="secondary">자금수지표 기준월은 파일에서 자동으로 확인합니다. 현재 자료로 가능한 지표부터 확인하세요.</Text>
                  </> : <>
                    <Heading level={1} type="display-3" textWrap="balance" id="workspace-heading" tabIndex={-1}>자금수지표로<br />월별 리스크 보고서를{ '\u00a0' }작성하세요</Heading>
                    <Text color="secondary">파일의 기준월을 확인하고, 산출 결과를 검토한 뒤<br />보고서를 PDF로 저장할 수 있습니다.</Text>
                  </>}
                </VStack>
                {upload}
              </>}
            </VStack> : section === 'past' ? <VStack gap={6}>
              <HStack><Button label="보관 목록으로 돌아가기" variant="ghost" size="sm" onClick={() => onNavigate('history')} /></HStack>
              {entry}{pending}
            </VStack> : <VStack id="workspace-history" role="tabpanel" aria-label="보관한 보고서" gap={6}>
              <Heading level={1} id="workspace-heading" tabIndex={-1}>보관한 보고서</Heading>
                {pending}
                {records}
                {backfill && <Collapsible trigger={backfillRunning ? '과거 위험 이력 보완 · 진행 중' : '과거 위험 이력 보완'} defaultIsOpen={false}>
                  <VStack gap={3} paddingBlock={3}>{backfill}</VStack>
                </Collapsible>}
            </VStack>}
          </VStack>
        </LayoutContent>} />
    </AppShell>
  </Theme></InternationalizationProvider>;
}
