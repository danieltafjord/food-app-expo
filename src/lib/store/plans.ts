import { useValue } from '@legendapp/state/react';

import { dateKeyOf } from '@/lib/week';
import { store$ } from './collections';
import { derived, derivedById } from './derived';
import { getLocalHouseholdId } from './household';
import { compareIso, newId, nowIso } from './ids';
import type { LocalDinnerPlan, MealType, PlanEntryWithDinner } from './schema';

/** All dinner plans, newest first. */
const plans$ = derived(() =>
  Object.values(store$.dinnerPlans.get()).sort((a, b) => compareIso(b.created_at, a.created_at)),
);

export function usePlans(): LocalDinnerPlan[] {
  return useValue(plans$);
}

/** The plan whose week starts on `weekStartKey` (a local YYYY-MM-DD), if any. */
export function usePlanForWeek(weekStartKey: string): LocalDinnerPlan | undefined {
  return useValue(() =>
    Object.values(store$.dinnerPlans.get()).find((p) => p.start_date === weekStartKey),
  );
}

export function usePlan(id: string | undefined): LocalDinnerPlan | undefined {
  return useValue(() => (id ? store$.dinnerPlans.get()[id] : undefined));
}

const NO_ENTRIES: PlanEntryWithDinner[] = [];

/**
 * Per-plan cache of the last joined entries keyed by their content. The
 * computed re-runs on any entry/dinner change (another week, a synced rename),
 * but returns the previous array while THIS plan's rows are unchanged — so the
 * week board, whose cards rebuild their gestures on every render, stays put.
 */
const planEntriesCache = new Map<string, { key: string; value: PlanEntryWithDinner[] }>();

const planEntriesFor = derivedById((planId): PlanEntryWithDinner[] => {
  const dinners = store$.dinners.get();
  const entries = Object.values(store$.planEntries.get())
    .filter((e) => e.dinner_plan_id === planId)
    .map((e) => ({ ...e, dinner_name: dinners[e.dinner_id]?.name ?? null }))
    .sort((a, b) => compareIso(a.created_at, b.created_at));

  const key = entries
    .map((e) => `${e.id}|${e.scheduled_date}|${e.servings}|${e.meal_type}|${e.dinner_id}|${e.dinner_name}|${e.notes ?? ''}`)
    .join(';');
  const cached = planEntriesCache.get(planId);
  if (cached && cached.key === key) return cached.value;
  planEntriesCache.set(planId, { key, value: entries });
  return entries;
});

/** Entries for a plan, joined with their dinner's name, in creation order. */
export function usePlanEntries(planId: string | undefined): PlanEntryWithDinner[] {
  return useValue(() => (planId ? planEntriesFor(planId).get() : NO_ENTRIES));
}

/** One entry joined with its dinner's name (undefined once deleted). */
export function usePlanEntry(entryId: string | undefined): PlanEntryWithDinner | undefined {
  return useValue(() => {
    if (!entryId) return undefined;
    const entry = store$.planEntries.get()[entryId];
    if (!entry) return undefined;
    return { ...entry, dinner_name: store$.dinners.get()[entry.dinner_id]?.name ?? null };
  });
}

/**
 * For every week that has a plan, the set of dates (local `YYYY-MM-DD`) that
 * carry at least one dinner — keyed by the plan's Monday `start_date`. Drives
 * the planner's week-overview grid (which weeks, and which days within them,
 * are filled).
 */
const weekFill$ = derived(() => {
  const weekByPlan: Record<string, string> = {};
  for (const plan of Object.values(store$.dinnerPlans.get())) {
    if (plan.start_date) weekByPlan[plan.id] = plan.start_date;
  }
  const fill: Record<string, Set<string>> = {};
  for (const entry of Object.values(store$.planEntries.get())) {
    const week = weekByPlan[entry.dinner_plan_id];
    if (!week) continue;
    (fill[week] ??= new Set<string>()).add(dateKeyOf(entry.scheduled_date));
  }
  return fill;
});

export function useWeekFill(): Record<string, Set<string>> {
  return useValue(weekFill$);
}

export type CreateDinnerPlanInput = {
  name: string;
  start_date?: string | null;
  end_date?: string | null;
};

export function createDinnerPlan(input: CreateDinnerPlanInput): string {
  const id = newId();
  const ts = nowIso();
  store$.dinnerPlans[id].set({
    id,
    household_id: getLocalHouseholdId(),
    name: input.name,
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    created_at: ts,
    updated_at: ts,
  });
  return id;
}

/** Find the plan for a week or create it. Synchronous — returns the plan id. */
export function ensurePlanForWeek(
  weekStartKey: string,
  weekEndKey: string,
  name: string,
): string {
  const existing = Object.values(store$.dinnerPlans.get()).find(
    (p) => p.start_date === weekStartKey,
  );
  if (existing) return existing.id;
  return createDinnerPlan({ name, start_date: weekStartKey, end_date: weekEndKey });
}

export type PlanEntryInput = {
  dinner_id: string;
  scheduled_date: string;
  servings: number;
  meal_type?: MealType;
  notes?: string | null;
};

export function createPlanEntry(planId: string, input: PlanEntryInput): string {
  const id = newId();
  const ts = nowIso();
  store$.planEntries[id].set({
    id,
    dinner_plan_id: planId,
    dinner_id: input.dinner_id,
    scheduled_date: input.scheduled_date,
    servings: input.servings,
    meal_type: input.meal_type ?? 'dinner',
    notes: input.notes ?? null,
    created_at: ts,
    updated_at: ts,
  });
  return id;
}

export type PlanEntryPatch = Partial<
  Pick<PlanEntryInput, 'scheduled_date' | 'servings' | 'meal_type' | 'notes' | 'dinner_id'>
>;

export function updatePlanEntry(entryId: string, patch: PlanEntryPatch): void {
  const entry$ = store$.planEntries[entryId];
  if (!entry$.get()) return;
  entry$.assign({ ...patch, updated_at: nowIso() });
}

export function deletePlanEntry(entryId: string): void {
  store$.planEntries[entryId].delete();
}
