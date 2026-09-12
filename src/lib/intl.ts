/**
 * Cached `Intl` objects. `toLocaleString` / `toLocaleDateString` / `localeCompare`
 * each construct a fresh formatter or collator per call, which on Hermes is the
 * dominant cost of formatting a list row or sorting a list of names. Everything
 * here is keyed by locale (+ options) and reused. No app imports, so it can be
 * used from the store layer without cycles.
 */

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();
const collators = new Map<string, Intl.Collator>();

export function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

export function numberFormatter(locale: string): Intl.NumberFormat {
  let formatter = numberFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale);
    numberFormatters.set(locale, formatter);
  }
  return formatter;
}

/** Locale-aware, case-insensitive name ordering (what `localeCompare` does, without the per-call setup). */
export function nameCollator(locale: string): Intl.Collator {
  let collator = collators.get(locale);
  if (!collator) {
    collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
    collators.set(locale, collator);
  }
  return collator;
}
