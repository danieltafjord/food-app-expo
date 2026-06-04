/**
 * Week math for the planner. Weeks run Monday→Sunday. All date keys are local
 * `YYYY-MM-DD` strings (never UTC), matching what we send to / slice from the API.
 */

import { getLocale } from '@/lib/store/settings';

export type WeekDay = {
  /** Local `YYYY-MM-DD`. */
  date: string;
  /** Short weekday name, localized, e.g. "Mon" / "man". */
  weekday: string;
  dayOfMonth: number;
  isToday: boolean;
};

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/** Local-time `YYYY-MM-DD` (avoids the UTC off-by-one that `toISOString` causes). */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The API returns ISO-8601 datetimes; the first 10 chars are the date. */
export function dateKeyOf(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

/** Local Date at midnight for a `YYYY-MM-DD` key — the inverse of `toDateKey`. */
export function fromDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

/** Monday of the week containing `date`, at local midnight. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = d.getDay(); // 0 = Sunday … 6 = Saturday
  const deltaToMonday = weekday === 0 ? -6 : 1 - weekday;
  return addDays(d, deltaToMonday);
}

export function buildWeek(weekStart: Date, locale: string = getLocale()): WeekDay[] {
  const todayKey = toDateKey(new Date());
  return Array.from({ length: 7 }, (_, index) => {
    const day = addDays(weekStart, index);
    const date = toDateKey(day);
    return {
      date,
      weekday: day.toLocaleDateString(locale, { weekday: 'short' }),
      dayOfMonth: day.getDate(),
      isToday: date === todayKey,
    };
  });
}

/** Human label for the week, e.g. "Jun 1 – 7" or "Jun 30 – Jul 6", in the app's language. */
export function weekLabel(weekStart: Date, locale: string = getLocale()): string {
  const weekEnd = addDays(weekStart, 6);
  const startMonth = weekStart.toLocaleDateString(locale, { month: 'short' });
  const endMonth = weekEnd.toLocaleDateString(locale, { month: 'short' });
  if (startMonth === endMonth) {
    return `${startMonth} ${weekStart.getDate()} – ${weekEnd.getDate()}`;
  }
  return `${startMonth} ${weekStart.getDate()} – ${endMonth} ${weekEnd.getDate()}`;
}
