import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

const koreanFallbacks = '"Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

/** Home controls only. The nested document theme retains its own typography and colors. */
export const homeTheme = defineTheme({
  name: 'aifrm-home',
  extends: neutralTheme,
  typography: {
    body: { family: 'Geist', fallbacks: koreanFallbacks },
    heading: { family: 'Geist', fallbacks: koreanFallbacks, weight: 'semibold' },
  },
  motion: {
    fast: 300,
    medium: 500,
    slow: 700,
    ratio: 1,
    easing: 'cubic-bezier(0.22,1,0.36,1)',
  },
  tokens: {
    '--font-size-xs': '0.75rem',
    '--font-size-sm': '0.875rem',
    '--font-size-base': '1rem',
    '--font-size-lg': '1.125rem',
    '--font-size-xl': '1.25rem',
    '--font-size-2xl': '1.5rem',
    '--font-size-3xl': '1.875rem',
    '--font-size-4xl': '2.25rem',
    '--font-size-5xl': '3rem',
    '--text-heading-1-size': 'var(--font-size-2xl)',
    '--text-heading-1-leading': '32px',
    '--text-heading-2-size': 'var(--font-size-xl)',
    '--text-heading-2-leading': '28px',
    '--text-heading-3-size': 'var(--font-size-lg)',
    '--text-heading-3-leading': '28px',
    '--text-heading-4-size': 'var(--font-size-base)',
    '--text-heading-4-leading': '24px',
    '--text-body-size': 'var(--font-size-base)',
    '--text-body-leading': '24px',
    '--text-large-size': 'var(--font-size-lg)',
    '--text-large-leading': '28px',
    '--text-label-size': 'var(--font-size-sm)',
    '--text-label-weight': 'var(--font-weight-semibold)',
    '--text-label-leading': '20px',
    '--text-supporting-size': 'var(--font-size-sm)',
    '--text-supporting-leading': '20px',
    '--text-display-3-size': 'var(--font-size-4xl)',
    '--text-display-3-weight': 'var(--font-weight-semibold)',
    '--text-display-3-leading': '40px',
    '--color-accent': 'var(--color-text-blue)',
  },
  components: {
    heading: {
      'type:display-3': {
        wordBreak: 'keep-all',
        overflowWrap: 'normal',
        fontWeight: 'var(--text-display-3-weight)',
        backgroundImage: 'linear-gradient(90deg, #000000, #666666)',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        color: 'transparent',
      },
    },
    button: {
      base: {
        fontSize: 'var(--font-size-base)',
        lineHeight: 'var(--text-body-leading)',
        fontWeight: 'var(--font-weight-semibold)',
      },
      'size:sm': {
        fontSize: 'var(--font-size-sm)',
        lineHeight: 'var(--text-label-leading)',
      },
    },
  },
});
