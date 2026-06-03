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
  return from || to || 'No dates set';
}

export function capitalize(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value;
}

/** "2 kg", "200 g", "1.5 l", or "" when both are missing. */
export function formatQuantity(quantity: number | null, unit: string | null): string {
  return [quantity != null ? String(quantity) : '', unit ?? ''].filter(Boolean).join(' ');
}

/** Compact relative time, e.g. "just now", "5m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
