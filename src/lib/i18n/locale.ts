import { getLocales } from 'expo-localization';

/** Languages the app ships with. */
export const LOCALES = ['en', 'nb'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Each language's name, written in that language (for the picker). */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  nb: 'Norsk',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Best-guess app locale from the device's language settings. Norwegian variants
 * (Bokmål `nb`, Nynorsk `nn`, macrolanguage `no`) map to `nb`; everything else
 * falls back to English.
 *
 * Defensive: `expo-localization` is a native module, so before a fresh dev build
 * picks it up the call can throw — we swallow that and use the default.
 */
export function getDeviceLocale(): Locale {
  try {
    const codes = getLocales().map((l) => (l.languageCode ?? '').toLowerCase());
    if (codes.some((c) => c === 'nb' || c === 'nn' || c === 'no')) {
      return 'nb';
    }
  } catch {
    // native module unavailable — fall through to the default
  }
  return DEFAULT_LOCALE;
}
