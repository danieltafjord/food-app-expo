import { useValue } from '@legendapp/state/react';

import { store$ } from './collections';
import { getLocalHouseholdId } from './household';
import { newId, nowIso } from './ids';
import type { LocalDinnerPlan, MealType, PlanEntryWithDinner } from './schema';

/** All dinner plans, newest first. */
export function usePlans(): LocalDinnerPlan[] {
  return useValue(() =>
    Object.values(store$.dinnerPlans.get()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    ),
  );
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

/** Entries for a plan, joined with their dinner's name, in creation order. */
export function usePlanEntries(planId: string | undefined): PlanEntryWithDinner[] {
  return useValue(() => {
    if (!planId) return [];
    const dinners = store$.dinners.get();
    return Object.values(store$.planEntries.get())
      .filter((e) => e.dinner_plan_id === planId)
      .map((e) => ({ ...e, dinner_name: dinners[e.dinner_id]?.name ?? null }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  });
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
