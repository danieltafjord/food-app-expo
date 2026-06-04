import { translate } from '@/lib/i18n';
import { getLocale } from '@/lib/store/settings';

/** Format an ISO-8601 string as a short date in the app's language. Falls back to the raw value. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
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

/** "2 kg", "200 g", "1,5 l" (nb) / "1.5 l" (en), or "" when both are missing. */
export function formatQuantity(quantity: number | null, unit: string | null): string {
  const amount =
    quantity != null && Number.isFinite(quantity) ? quantity.toLocaleString(getLocale()) : '';
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
