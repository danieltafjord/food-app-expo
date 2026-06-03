/**
 * Tiny, dependency-free i18n built on the local settings store.
 *
 * - `useT()` returns a `t(key, vars?)` bound to the active language; it
 *   re-renders when the user switches languages (the locale lives in
 *   `store$.settings`, read reactively via `useLocale`).
 * - `translate(locale, key, vars?)` is the non-reactive equivalent.
 *
 * Keys are dot-paths into the English dictionary (`'account.signOut'`) and are
 * type-checked, so a typo or a key missing from a translation is a compile
 * error. Missing translations fall back to English, then to the raw key.
 */
import { useLocale } from '@/lib/store/settings';

import { en, type Dictionary } from './en';
import { type Locale } from './locale';
import { nb } from './nb';

export {
  DEFAULT_LOCALE,
  getDeviceLocale,
  isLocale,
  LOCALE_LABELS,
  LOCALES,
  type Locale,
} from './locale';

const dictionaries: Record<Locale, Dictionary> = { en, nb };

/** Union of every valid dot-path into the dictionary, e.g. `'common.save'`. */
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type TKey = Paths<Dictionary>;

type Vars = Record<string, string | number>;

function lookup(dict: Dictionary, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in node) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function translate(locale: Locale, key: TKey, vars?: Vars): string {
  const value = lookup(dictionaries[locale], key) ?? lookup(en, key) ?? key;
  return interpolate(value, vars);
}

export type TFunction = (key: TKey, vars?: Vars) => string;

export function useT(): TFunction {
  const locale = useLocale();
  return (key, vars) => translate(locale, key, vars);
}
