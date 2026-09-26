/** Local reminder preferences. Dependency-free: the store's shape imports it. */

export type ReminderSettings = {
  /** Remind about tonight's dinner. */
  dinner: boolean;
  /** Local `HH:MM` for the dinner reminder. */
  dinnerTime: string;
  /** Nudge on Sunday evening when next week has nothing planned. */
  planWeek: boolean;
};

export const DEFAULT_REMINDERS: ReminderSettings = { dinner: false, dinnerTime: '16:00', planWeek: false };

export const DINNER_REMINDER_TIMES = ['15:00', '16:00', '17:00', '18:00'] as const;
