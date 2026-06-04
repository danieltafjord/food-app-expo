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
 */
const plannerWeek$ = observable(toDateKey(startOfWeek(new Date())));

export function usePlannerWeekKey(): string {
  return useValue(() => plannerWeek$.get());
}

export function setPlannerWeekKey(weekStartKey: string): void {
  plannerWeek$.set(weekStartKey);
}
