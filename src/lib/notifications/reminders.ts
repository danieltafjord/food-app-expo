/**
 * Local reminders, worked out from the plan on this device and scheduled with
 * the OS (see `./native`). They need no account and no network: the device
 * already holds the plan, and knows its own clock and time zone.
 *
 *  - "Tonight: Tacos" at the chosen time on each of the next days that has a
 *    dinner planned.
 *  - "Plan next week" on Sunday evening, only while next week is still empty.
 *
 * Pure, so the schedule is unit tested; the caller diffs it against what is
 * already scheduled.
 */

import type { LocalPlanEntry } from '@/lib/store/schema';
import { addDays, startOfWeek, toDateKey } from '@/lib/week';

import type { ReminderSettings } from './reminder-settings';

export { DEFAULT_REMINDERS, DINNER_REMINDER_TIMES, type ReminderSettings } from './reminder-settings';

/** Sunday, 18:00 local time. */
const PLAN_WEEK_HOUR = 18;

/** How many days of dinner reminders are kept scheduled ahead. */
export const DINNER_REMINDER_DAYS = 7;

export type PlannedReminder = {
  /** Stable while the reminder's content and time are unchanged. */
  id: string;
  at: Date;
  title: string;
  body: string;
  /** Monday (`YYYY-MM-DD`) of the week a tap should open. */
  week: string;
};

type Strings = {
  dinnerTitle: string;
  planWeekTitle: string;
  planWeekBody: string;
};

export function planReminders(input: {
  now: Date;
  settings: ReminderSettings;
  entries: readonly Pick<LocalPlanEntry, 'scheduled_date' | 'dinner_id' | 'meal_type'>[];
  dinnerName: (dinnerId: string) => string | null | undefined;
  strings: Strings;
}): PlannedReminder[] {
  const { now, settings, entries, dinnerName, strings } = input;
  const reminders: PlannedReminder[] = [];

  const byDay = new Map<string, string[]>();
  for (const entry of entries) {
    const list = byDay.get(entry.scheduled_date) ?? [];
    list.push(entry.dinner_id);
    byDay.set(entry.scheduled_date, list);
  }

  if (settings.dinner) {
    const [hour, minute] = parseTime(settings.dinnerTime);
    for (let offset = 0; offset < DINNER_REMINDER_DAYS; offset += 1) {
      const day = addDays(now, offset);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      if (at <= now) continue;
      const key = toDateKey(at);
      const dinners = entries
        .filter((entry) => entry.scheduled_date === key && entry.meal_type === 'dinner')
        .map((entry) => dinnerName(entry.dinner_id))
        .filter((name): name is string => !!name);
      const names = [...new Set(dinners)];
      if (names.length === 0) continue;
      const body = names.join(', ');
      reminders.push({
        id: `dinner.${key}.${hash(`${settings.dinnerTime}|${body}`)}`,
        at,
        title: strings.dinnerTitle,
        body,
        week: toDateKey(startOfWeek(at)),
      });
    }
  }

  if (settings.planWeek) {
    const at = nextSundayEvening(now);
    const monday = addDays(at, 1);
    const empty = !Array.from({ length: 7 }, (_, i) => toDateKey(addDays(monday, i))).some((key) => byDay.has(key));
    if (empty) {
      const week = toDateKey(monday);
      reminders.push({
        id: `plan-week.${week}`,
        at,
        title: strings.planWeekTitle,
        body: strings.planWeekBody,
        week,
      });
    }
  }

  return reminders;
}

/** The coming Sunday at 18:00 — today, if it is Sunday before then. */
function nextSundayEvening(now: Date): Date {
  const daysUntilSunday = (7 - now.getDay()) % 7;
  const sunday = addDays(now, daysUntilSunday);
  const at = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate(), PLAN_WEEK_HOUR, 0);
  return at > now ? at : addDays(at, 7);
}

function parseTime(value: string): [number, number] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  const hour = match ? Number(match[1]) : 16;
  const minute = match ? Number(match[2]) : 0;
  return hour < 24 && minute < 60 ? [hour, minute] : [16, 0];
}

/** A short, stable fingerprint, so a changed reminder gets a new id. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
