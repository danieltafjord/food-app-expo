import { useValue } from '@legendapp/state/react';

import { DEFAULT_LOCALE, getDeviceLocale, isLocale, type Locale } from '@/lib/i18n/locale';

import { store$ } from './collections';

/** The user's theme choice. `system` follows the OS light/dark setting. */
export type ThemePreference = 'system' | 'light' | 'dark';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Seed any unset settings once on first launch (after hydration). The locale
 * starts as `''` and is filled in from the device language here; the theme
 * defaults to following the OS, so nothing to seed there.
 */
export function ensureSettingsDefaults(): void {
  if (!store$.settings.locale.get()) {
    store$.settings.locale.set(getDeviceLocale());
  }
}

export function useThemePreference(): ThemePreference {
  return useValue(store$.settings.theme);
}

export function setThemePreference(theme: ThemePreference): void {
  store$.settings.theme.set(theme);
}

/** Reactive read of the active language, falling back to the default. */
export function useLocale(): Locale {
  return useValue(() => {
    const stored = store$.settings.locale.get();
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  });
}

/** Non-reactive accessor (for use outside React). */
export function getLocale(): Locale {
  const stored = store$.settings.locale.get();
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

export function setLocale(locale: Locale): void {
  store$.settings.locale.set(locale);
}

/**
 * Adopt the settings persisted on the server (called once `/me` loads) so a
 * freshly signed-in device picks up the user's saved theme + language. Unknown
 * values are ignored, keeping the local choice.
 */
export function applyServerSettings(theme: unknown, locale: unknown): void {
  if (isThemePreference(theme)) {
    store$.settings.theme.set(theme);
  }
  if (isLocale(locale)) {
    store$.settings.locale.set(locale);
  }
}
