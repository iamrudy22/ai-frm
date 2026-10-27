'use client';

import type { ReactNode } from 'react';
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
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import '@astryxdesign/theme-neutral/theme.css';

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
  readonly notices?: ReactNode;
  readonly results?: ReactNode;
  readonly details?: ReactNode;
  readonly pending?: ReactNode;
  readonly records?: ReactNode;
  readonly entry?: ReactNode;
  readonly backfill?: ReactNode;
  readonly backfillRunning?: boolean;
};

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
export function HomeWorkspace({ section, onNavigate, onPast, upload, notices, results, details, pending, records, entry, backfill, backfillRunning = false }: Props) {
  return <InternationalizationProvider locale="ko" messages={{ ko: koreanMessages }}><Theme theme={neutralTheme} mode="light">
    <AppShell height="auto" variant="surface">
      <Layout contentWidth={960} height="auto" padding={5}
        header={<LayoutHeader paddingBlockEnd={0}>
          <VStack gap={5} paddingBlockStart={4}>
            <HStack gap={4} wrap="wrap" hAlign="between" vAlign="center">
              <VStack gap={2}>
                <Heading level={1}>월별 자금 리스크 보고서</Heading>
                <Text color="secondary">자금수지표를 올려 보고서를 작성하고 월별로 보관하세요.</Text>
              </VStack>
              <Button label="과거 자료 등록" onClick={event => onPast(event.currentTarget)} />
            </HStack>
            <TabList value={section === 'past' ? 'history' : section} onChange={value => onNavigate(value as HomeSection)}
              role="tablist" hasDivider aria-label="보고서 작업">
              <Tab value="create" label="보고서 작성" panelId="workspace-create" />
              <Tab value="history" label="보관한 보고서" panelId="workspace-history" />
            </TabList>
          </VStack>
        </LayoutHeader>}
        content={<LayoutContent isScrollable={false} padding={0}>
          <VStack gap={5} paddingInline={5} paddingBlockStart={5} paddingBlockEnd={8}>
            {section === 'create' ? <VStack id="workspace-create" role="tabpanel" aria-label="보고서 작성" gap={5}>
              {notices}
              {results ? <>{results}{upload}{details}</> : <>
                <VStack gap={2}>
                  <Heading level={2} id="workspace-heading" tabIndex={-1}>자금수지표 업로드</Heading>
                  <Text color="secondary">가지고 있는 자료를 올려주세요. 파일을 읽고 필요한 자료를 안내합니다.</Text>
                </VStack>
                {upload}
                <HStack><Button label="엑셀 없이 직접 입력" variant="ghost" onClick={event => onPast(event.currentTarget)} /></HStack>
              </>}
            </VStack> : <VStack id="workspace-history" role="tabpanel" aria-label="보관한 보고서" gap={5}>
              {section === 'history' && <Heading level={2} id="workspace-heading" tabIndex={-1}>보관한 보고서</Heading>}
              {section === 'past' ? <>{entry}{pending}</> : <>
                {pending}
                {records}
                {backfill && <Collapsible trigger={backfillRunning ? '과거 위험 이력 보완 · 진행 중' : '과거 위험 이력 보완'} defaultIsOpen={false}>
                  <VStack gap={3} paddingBlock={3}>{backfill}</VStack>
                </Collapsible>}
              </>}
            </VStack>}
          </VStack>
        </LayoutContent>} />
    </AppShell>
  </Theme></InternationalizationProvider>;
}
