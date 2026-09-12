import { observable } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';

import { startOfWeek, toDateKey } from '@/lib/week';

/**
 * Which week the Plans tab is showing — a Monday `YYYY-MM-DD` key.
 *
 * Held in an observable rather than screen state so the week-overview modal,
 * presented above the tab bar as its own root route, can change it and have the
 * board update reactively once dismissed (a route can't reach the screen's local
 * state). UI-only; intentionally not part of the persisted store.
 *
 * `''` means "not chosen yet": the current week is computed on first read, not
 * at module load, so an app that was launched last Sunday (or before midnight)
 * opens on the *current* week instead of a stale one. Explicitly navigating
 * (arrows, "This week", the overview) pins a key.
 */
const plannerWeek$ = observable('' as string);

function currentWeekKey(): string {
  return toDateKey(startOfWeek(new Date()));
}

export function usePlannerWeekKey(): string {
  return useValue(() => plannerWeek$.get() || currentWeekKey());
}

export function setPlannerWeekKey(weekStartKey: string): void {
  plannerWeek$.set(weekStartKey);
}
