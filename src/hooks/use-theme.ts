/**
 * Resolves the active color scheme + palette from the user's theme preference
 * and the OS setting.
 *
 * The resolution is done ONCE, at the root (`useResolvedSchemeSource` in
 * `ThemedRoot`), and handed down through `SchemeContext`. Every themed leaf
 * (`ThemedText`, `Button`, …) then pays a single `use(Context)` instead of its
 * own store subscription + Appearance listener per render.
 *
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { createContext, use } from 'react';
import { Appearance } from 'react-native';

import { Colors, type ColorScheme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { store$ } from '@/lib/store/collections';
import { useThemePreference, type ThemePreference } from '@/lib/store/settings';

export const SchemeContext = createContext<ColorScheme | null>(null);

function resolve(preference: ThemePreference, device: string | null | undefined): ColorScheme {
  if (preference === 'light' || preference === 'dark') {
    return preference;
  }
  return device === 'dark' ? 'dark' : 'light';
}

/** The reactive source: subscribes to the preference and the OS scheme. Root only. */
export function useResolvedSchemeSource(): ColorScheme {
  const device = useColorScheme();
  const preference = useThemePreference();
  return resolve(preference, device);
}

/**
 * The concrete scheme to render. Reads the root-provided value; outside the
 * provider (the boot error screen, the root error boundary) it falls back to a
 * one-off, non-reactive resolution.
 */
export function useResolvedScheme(): ColorScheme {
  const provided = use(SchemeContext);
  if (provided) {
    return provided;
  }
  return resolve(store$.settings.theme.peek(), Appearance.getColorScheme());
}

export function useTheme() {
  return Colors[useResolvedScheme()];
}
