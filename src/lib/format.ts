import { translate } from '@/lib/i18n';
import { dateFormatter, numberFormatter } from '@/lib/intl';
import { getLocale } from '@/lib/store/settings';
import { fromDateKey } from '@/lib/week';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
const SHORT_DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

/**
 * Format an ISO-8601 datetime or a `YYYY-MM-DD` date key as a short date in the
 * app's language. A bare date key is a *local* calendar day (it has no time or
 * zone), so it is parsed with `fromDateKey` — `new Date('2026-06-01')` would
 * treat it as UTC midnight and show the previous day west of Greenwich. Falls
 * back to the raw value when it can't be parsed.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const date = DATE_KEY.test(iso) ? fromDateKey(iso) : new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return dateFormatter(getLocale(), SHORT_DATE).format(date);
}

/** Like `formatDate` but without the year — for dates near today ("12. sep."). */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const date = DATE_KEY.test(iso) ? fromDateKey(iso) : new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return dateFormatter(getLocale(), SHORT_DAY).format(date);
}

/** Render a plan's date range, tolerating missing ends. */
export function formatDateRange(start: string | null, end: string | null): string {
  const from = formatDate(start);
  const to = formatDate(end);
  if (from && to) {
    return `${from} – ${to}`;
  }
  return from || to || translate(getLocale(), 'common.noDates');
}

export function capitalize(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value;
}

/**
 * Parse a user-typed quantity. Accepts a comma or a dot as the decimal separator
 * (the nb-NO decimal keypad offers a comma, and `Number('1,5')` is `NaN`).
 * Returns `null` for empty, non-numeric, or negative input.
 */
export function parseQuantity(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!normalized) {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** "2 kg", "200 g", "1,5 l" (nb) / "1.5 l" (en), or "" when both are missing. */
export function formatQuantity(quantity: number | null, unit: string | null): string {
  const amount =
    quantity != null && Number.isFinite(quantity) ? numberFormatter(getLocale()).format(quantity) : '';
  return [amount, unit ?? ''].filter(Boolean).join(' ');
}

/** Compact relative time in the app's language, e.g. "just now", "5m ago". */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const locale = getLocale();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return translate(locale, 'time.justNow');
  const mins = Math.round(secs / 60);
  if (mins < 60) return translate(locale, 'time.minutesAgo', { count: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return translate(locale, 'time.hoursAgo', { count: hours });
  return translate(locale, 'time.daysAgo', { count: Math.round(hours / 24) });
}

/**
 * A weekday with its day of the month, in the given language's order and
 * punctuation: "man. 21." (nb, ordinal dot) / "Mon 21" (en). `weekday` is the
 * already localized name (see `buildWeek`), so lists of days share one formatter.
 */
export function weekdayWithDay(weekday: string, dayOfMonth: number, locale: string = getLocale()): string {
  return usesOrdinalDot(locale) ? `${weekday} ${dayOfMonth}.` : `${weekday} ${dayOfMonth}`;
}

/** Languages that write the day of the month as an ordinal with a dot ("21."). */
function usesOrdinalDot(locale: string): boolean {
  return /^(nb|nn|no|da|de)\b/i.test(locale);
}
