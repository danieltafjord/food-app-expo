/**
 * Central color + spacing tokens for the app.
 *
 * Surfaces use the Tailwind CSS **neutral** palette; dark mode leans into the
 * very dark end (neutral-950/900/800) for a deep, high-contrast look. The brand
 * blue (`tint`) is the only chromatic accent and is brightened slightly in dark
 * mode so it stays legible on near-black. Every screen reads these through
 * `useTheme()` (resolved against the user's theme preference + OS scheme) so
 * nothing should hardcode a color outside this file.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0a0a0a', // neutral-950
    textSecondary: '#525252', // neutral-600
    background: '#ffffff',
    backgroundElement: '#f5f5f5', // neutral-100
    backgroundSelected: '#e5e5e5', // neutral-200
    border: '#e5e5e5', // neutral-200
    tint: '#208AEF', // brand blue
    onTint: '#ffffff',
    danger: '#dc2626', // red-600
  },
  dark: {
    text: '#fafafa', // neutral-50
    textSecondary: '#a3a3a3', // neutral-400
    background: '#0a0a0a', // neutral-950
    backgroundElement: '#171717', // neutral-900
    backgroundSelected: '#262626', // neutral-800
    border: '#262626', // neutral-800
    tint: '#3b9eff', // brand blue, brightened for dark surfaces
    onTint: '#ffffff',
    danger: '#f87171', // red-400
  },
} as const;

export type ColorScheme = keyof typeof Colors;
export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export type BadgeTone = 'neutral' | 'brand' | 'positive' | 'warning' | 'danger';

/** Per-scheme badge backgrounds/foregrounds. Light uses soft pastels; dark uses
 * deep tinted fills with bright text so badges read on neutral-900 cards. */
export const BadgeColors: Record<ColorScheme, Record<BadgeTone, { bg: string; fg: string }>> = {
  light: {
    neutral: { bg: '#e5e5e5', fg: '#404040' },
    brand: { bg: '#d5e8ff', fg: '#0d5bba' },
    positive: { bg: '#d6f3df', fg: '#1c7a43' },
    warning: { bg: '#fdeecd', fg: '#9a6700' },
    danger: { bg: '#fde0e1', fg: '#c0353a' },
  },
  dark: {
    neutral: { bg: '#262626', fg: '#d4d4d4' },
    brand: { bg: '#14304d', fg: '#7cc0ff' },
    positive: { bg: '#13331f', fg: '#6ee7a0' },
    warning: { bg: '#3a2e10', fg: '#f0c869' },
    danger: { bg: '#3a1718', fg: '#f3a0a3' },
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

// Clearance for the floating bottom tab bar (iOS 26 bar + home indicator ≈ 83–90pt),
// so scrollable content isn't hidden underneath it.
export const BottomTabInset = Platform.select({ ios: 92, android: 88 }) ?? 0;
export const MaxContentWidth = 800;
