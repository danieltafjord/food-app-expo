import { batch } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';

import { dinnerCategory, type DinnerCategory } from '@/lib/dinner-categories';
import { addDays, dateKeyOf, fromDateKey, toDateKey } from '@/lib/week';
import { store$ } from './collections';
import { createPlanEntry, ensurePlanForWeek } from './plans';

type Candidate = { id: string; name: string; servings: number; weight: number; category: DinnerCategory | null };
export type WeekPlanningContext = {
  weekStart: string;
  dates: string[];
  candidates: Candidate[];
  categoryCounts: Partial<Record<DinnerCategory, number>>;
  missing: number;
  key: string;
};
export type WeekDraft = {
  weekStart: string;
  contextKey: string;
  entries: { date: string; dinnerId: string; name: string; servings: number; category: DinnerCategory | null }[];
};

const dinnerNameKey = (name: string) => name.trim().normalize('NFKC').toLowerCase();

/** Read a detached snapshot; previewing never creates a plan or changes the store. */
export function getWeekPlanningContext(
  weekStart: string,
  today = toDateKey(new Date()),
): WeekPlanningContext {
  const householdId = store$.meta.localHouseholdId.get();
  const dinners = Object.values(store$.dinners.get())
    .filter((dinner) => dinner.household_id === householdId && dinner.name.trim())
    .sort((a, b) => a.id.localeCompare(b.id));
  const plans = Object.values(store$.dinnerPlans.get())
    .filter((plan) => plan.household_id === householdId);
  const planIds = new Set(plans.map((plan) => plan.id));
  const entries = Object.values(store$.planEntries.get())
    .filter((entry) => planIds.has(entry.dinner_plan_id));
  const days = Array.from({ length: 7 }, (_, i) => toDateKey(addDays(fromDateKey(weekStart), i)));
  // Include all household plans for these dates, including duplicate weekly plans.
  const weekEntries = entries.filter((entry) => days.includes(dateKeyOf(entry.scheduled_date)));
  const occupied = new Set(weekEntries.map((entry) => dateKeyOf(entry.scheduled_date)));
  const usedIds = new Set(weekEntries.map((entry) => entry.dinner_id));
  const categoryCounts: Partial<Record<DinnerCategory, number>> = {};
  const categoriesById = new Map(dinners.map((dinner) => [dinner.id, dinnerCategory(dinner.category)]));
  for (const entry of weekEntries) {
    const category = categoriesById.get(entry.dinner_id);
    if (category) categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
  }
  const usedNames = new Set(
    dinners.filter((dinner) => usedIds.has(dinner.id)).map((dinner) => dinnerNameKey(dinner.name)),
  );
  const dates = days.filter((date) => date >= today && !occupied.has(date));
  const lastPlanned = new Map<string, string>();
  for (const entry of entries) {
    const date = dateKeyOf(entry.scheduled_date);
    // Later weeks must not erase the history preceding the week we're planning.
    if (date && date < weekStart && date > (lastPlanned.get(entry.dinner_id) ?? '')) {
      lastPlanned.set(entry.dinner_id, date);
    }
  }
  const seenNames = new Set(usedNames);
  const candidates: Candidate[] = [];
  for (const dinner of dinners) {
    const nameKey = dinnerNameKey(dinner.name);
    if (usedIds.has(dinner.id) || seenNames.has(nameKey)) continue;
    seenNames.add(nameKey);
    const last = lastPlanned.get(dinner.id);
    const daysSince = last
      ? Math.round((fromDateKey(weekStart).getTime() - fromDateKey(last).getTime()) / 86_400_000)
      : 60;
    candidates.push({
      id: dinner.id,
      name: dinner.name,
      servings: dinner.default_servings,
      category: dinnerCategory(dinner.category),
      // Weighted sampling keeps recent dinners possible, while favouring variety.
      weight: Math.max(1, Math.min(60, daysSince)),
    });
  }
  return {
    weekStart,
    dates,
    candidates,
    categoryCounts,
    missing: Math.max(0, dates.length - candidates.length),
    key: JSON.stringify([
      householdId,
      store$.meta.accountId.get(),
      weekStart,
      dates,
      candidates.map(({ id, name, servings, category, weight }) => [id, name, servings, category, weight]),
      categoryCounts,
    ]),
  };
}

export function useWeekPlanningContext(weekStart: string): WeekPlanningContext {
  return useValue(() => getWeekPlanningContext(weekStart));
}

export function suggestWeek(
  context: WeekPlanningContext,
  previous?: WeekDraft | null,
  random: () => number = Math.random,
): WeekDraft | null {
  if (!context.dates.length || context.missing > 0) return null;
  const pool = [...context.candidates];
  const selected: Candidate[] = [];
  const categoryCounts = { ...context.categoryCounts };
  for (let day = 0; day < context.dates.length; day += 1) {
    // A soft preference: repeated categories remain eligible. Unclassified
    // dinners and the catch-all are neutral, so categorization is never required.
    const weights = pool.map((dinner) => dinner.weight / (
      dinner.category && dinner.category !== 'other' ? 1 + (categoryCounts[dinner.category] ?? 0) : 1
    ));
    let remaining = random() * weights.reduce((sum, weight) => sum + weight, 0);
    let index = 0;
    while (index < pool.length - 1 && remaining >= weights[index]) {
      remaining -= weights[index];
      index += 1;
    }
    const dinner = pool.splice(index, 1)[0];
    selected.push(dinner);
    if (dinner.category) categoryCounts[dinner.category] = (categoryCounts[dinner.category] ?? 0) + 1;
  }
  // Randomise days too: the highest-weight choice needn't always be Monday.
  for (let i = selected.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }
  if (previous?.contextKey === context.key
    && selected.every((dinner, i) => dinner.id === previous.entries[i]?.dinnerId)) {
    // A shuffle should visibly change the preview whenever another option exists.
    if (pool.length) selected[0] = pool[Math.floor(random() * pool.length)];
    else if (selected.length > 1) selected.push(selected.shift()!);
  }
  return {
    weekStart: context.weekStart,
    contextKey: context.key,
    entries: selected.map((dinner, index) => ({
      date: context.dates[index],
      dinnerId: dinner.id,
      name: dinner.name,
      servings: dinner.servings,
      category: dinner.category,
    })),
  };
}

/** Recheck the live store before writing anything; stale previews require another review. */
export function applyWeekDraft(
  draft: WeekDraft,
  planName: string,
  today = toDateKey(new Date()),
): boolean {
  const context = getWeekPlanningContext(draft.weekStart, today);
  if (draft.contextKey !== context.key || context.missing > 0 || !context.dates.length) return false;
  const candidates = new Map(context.candidates.map((dinner) => [dinner.id, dinner]));
  if (draft.entries.length !== context.dates.length
    || new Set(draft.entries.map((entry) => entry.dinnerId)).size !== draft.entries.length
    || draft.entries.some((entry, index) => {
      const dinner = candidates.get(entry.dinnerId);
      return entry.date !== context.dates[index] || !dinner
        || entry.name !== dinner.name || entry.servings !== dinner.servings || entry.category !== dinner.category;
    })) return false;

  batch(() => {
    const planId = ensurePlanForWeek(
      draft.weekStart,
      toDateKey(addDays(fromDateKey(draft.weekStart), 6)),
      planName,
    );
    for (const entry of draft.entries) {
      createPlanEntry(planId, {
        dinner_id: entry.dinnerId,
        scheduled_date: entry.date,
        servings: entry.servings,
      });
    }
  });
  return true;
}
