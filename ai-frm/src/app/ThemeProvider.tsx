'use client';

import { useMemo } from 'react';
import { defineTheme, Theme } from '@astryxdesign/core';

function makeTheme() {
  return defineTheme({
    name: 'my-theme',
    color: { accent: '#0064E0', neutralStyle: 'cool', contrast: 'standard' },
    typography: {
      scale: { base: 16, ratio: 1.2 },
      body: {
        family: 'Inter',
        fallbacks: '-apple-system, system-ui, sans-serif',
      },
      heading: { weight: 'semibold', weights: { 1: 'bold', 2: 'bold' } },
      code: {
        family: 'Geist Mono',
        fallbacks: '"SF Mono", ui-monospace, monospace',
      },
    },
    radius: { base: 4, multiplier: 1 },
    motion: { fast: 175, medium: 410, slow: 975, ratio: 0.75 },
    tokens: {
      '--color-accent': ['#0064E0', '#2694FE'],
      '--color-on-accent': ['#FFFFFF', '#FFFFFF'],
      '--color-background-body': ['#F1F4F7', '#111112'],
      '--color-background-surface': ['#FFFFFF', '#1F1F22'],
      '--focus-outline-color': 'var(--color-accent)',
      '--shadow-low': '0 1px 2px light-dark(#0000001A, #00000066)',
    },
    components: {
      button: {
        base: {
          borderRadius: 'var(--radius-full)',
          fontWeight: 'var(--font-weight-semibold)',
          '--button-focus-offset': '2px',
          ':hover': { transform: 'translateY(-1px)' },
          ':active': { transform: 'translateY(0)' },
        },
        'variant:ghost': { borderWidth: '1px', borderStyle: 'solid' },
        'variant:destructive+size:sm': { letterSpacing: '0.02em' },
        'variant:quiet': {
          backgroundColor: 'var(--color-background-muted)',
          color: 'var(--color-text-secondary)',
        },
      },
      card: {
        base: {
          borderRadius: 'var(--radius-container)',
          padding: 'var(--spacing-6)',
        },
      },
      text: {
        'type:hero': { fontSize: 'var(--font-size-4xl)', lineHeight: '1.05' },
      },
    },
  });
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useMemo(() => makeTheme(), []);
  return <Theme theme={theme} mode="system">{children}</Theme>;
}
