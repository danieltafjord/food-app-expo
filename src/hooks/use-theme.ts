/**
 * Resolves the active color scheme + palette from the user's theme preference
 * and the OS setting.
 *
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors, type ColorScheme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemePreference } from '@/lib/store/settings';

/** The concrete scheme to render: the preference, or the OS scheme when 'system'. */
export function useResolvedScheme(): ColorScheme {
  const device = useColorScheme();
  const preference = useThemePreference();
  if (preference === 'light' || preference === 'dark') {
    return preference;
  }
  return device === 'dark' ? 'dark' : 'light';
}

export function useTheme() {
  return Colors[useResolvedScheme()];
}
