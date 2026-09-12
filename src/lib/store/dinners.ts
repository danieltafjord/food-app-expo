import { useValue } from '@legendapp/state/react';

import { dateKeyOf } from '@/lib/week';
import { store$ } from './collections';
import { getHouseholdDefaultServings, getLocalHouseholdId } from './household';
import { compareIso, newId, nowIso } from './ids';
import type { DinnerWithItems, LocalDinner, LocalDinnerItem, LocalPlanEntry } from './schema';

function itemsForDinner(
  allItems: Record<string, LocalDinnerItem>,
  dinnerId: string,
): LocalDinnerItem[] {
  return Object.values(allItems)
    .filter((it) => it.dinner_id === dinnerId)
    .sort((a, b) => compareIso(a.created_at, b.created_at));
}

/** All dinners (recipes) with their items, alphabetised. */
export function useDinners(): DinnerWithItems[] {
  return useValue(() => {
    // One pass over the items, grouped by dinner, instead of a scan per dinner.
    const byDinner = new Map<string, LocalDinnerItem[]>();
    for (const it of Object.values(store$.dinnerItems.get())) {
      const bucket = byDinner.get(it.dinner_id);
      if (bucket) bucket.push(it);
      else byDinner.set(it.dinner_id, [it]);
    }
    return Object.values(store$.dinners.get())
      .map((d) => ({
        ...d,
        items: (byDinner.get(d.id) ?? []).sort((a, b) => compareIso(a.created_at, b.created_at)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

/** A dinner as the picker lists it: no items, plus when it was last on a plan. */
export type DinnerOption = LocalDinner & {
  /**
   * The latest `scheduled_date` (local `YYYY-MM-DD`) of any plan entry for
   * this dinner, past or future, or null if it has never been planned.
   */
  last_planned: string | null;
};

/**
 * Order dinners by recency: most recently planned first (so the household's
 * actual rotation is on top), never-planned ones after, ties alphabetical.
 * Pure — `useDinnerOptions` wraps it reactively.
 */
export function rankByRecency(
  dinners: readonly LocalDinner[],
  entries: readonly LocalPlanEntry[],
): DinnerOption[] {
  const last = new Map<string, string>();
  for (const entry of entries) {
    const key = dateKeyOf(entry.scheduled_date);
    const prev = last.get(entry.dinner_id);
    if (!prev || key > prev) last.set(entry.dinner_id, key);
  }
  return dinners
    .map((d) => ({ ...d, last_planned: last.get(d.id) ?? null }))
    .sort((a, b) => {
      if (a.last_planned !== b.last_planned) {
        if (!a.last_planned) return 1;
        if (!b.last_planned) return -1;
        return b.last_planned.localeCompare(a.last_planned);
      }
      return a.name.localeCompare(b.name);
    });
}

/**
 * Dinners without their items, most recently planned first — for pickers that
 * only show the name and recency, so they don't join the items collection.
 */
export function useDinnerOptions(): DinnerOption[] {
  return useValue(() =>
    rankByRecency(Object.values(store$.dinners.get()), Object.values(store$.planEntries.get())),
  );
}

/** A single dinner with its items, or undefined if it doesn't exist. */
export function useDinner(id: string): DinnerWithItems | undefined {
  return useValue(() => {
    const dinner = store$.dinners[id].get();
    return dinner ? { ...dinner, items: itemsForDinner(store$.dinnerItems.get(), id) } : undefined;
  });
}

/** Non-reactive read of a dinner with its items (e.g. right after creating one). */
export function getDinner(id: string): DinnerWithItems | undefined {
  const dinner = store$.dinners[id].get();
  if (!dinner) return undefined;
  return { ...dinner, items: itemsForDinner(store$.dinnerItems.get(), id) };
}

export type CreateDinnerInput = {
  name: string;
  default_servings?: number;
  notes?: string | null;
};

export function createDinner(input: CreateDinnerInput): string {
  const id = newId();
  const ts = nowIso();
  store$.dinners[id].set({
    id,
    household_id: getLocalHouseholdId(),
    name: input.name,
    default_servings: input.default_servings ?? getHouseholdDefaultServings(),
    notes: input.notes ?? null,
    created_at: ts,
    updated_at: ts,
  });
  return id;
}

export type DinnerItemInput = {
  ingredient_id: string;
  quantity?: number | null;
  unit?: string | null;
};

export type UpdateDinnerInput = {
  name: string;
  default_servings: number;
  notes?: string | null;
  /** The dinner's full ingredient list after the update (diffed by ingredient). */
  items: DinnerItemInput[];
};

export function updateDinner(id: string, input: UpdateDinnerInput): void {
  const dinner$ = store$.dinners[id];
  if (!dinner$.get()) return;
  dinner$.assign({
    name: input.name,
    default_servings: input.default_servings,
    notes: input.notes ?? null,
    updated_at: nowIso(),
  });
  setDinnerItems(id, input.items);
}

/**
 * Set a dinner's items to exactly `items`, diffing by `ingredient_id` so that an
 * unchanged ingredient keeps its row (and its id). Stable ids matter for sync:
 * delete-and-recreate would turn every save into a tombstone plus a fresh row,
 * and two devices saving the same dinner would end up with doubled items.
 * When the same ingredient appears more than once in `items`, the last entry wins.
 */
export function setDinnerItems(dinnerId: string, items: DinnerItemInput[]): void {
  const ts = nowIso();
  const existingByIngredient = new Map<string, LocalDinnerItem>();
  for (const it of Object.values(store$.dinnerItems.get())) {
    if (it.dinner_id === dinnerId) {
      existingByIngredient.set(it.ingredient_id, it);
    }
  }

  const wanted = new Map<string, DinnerItemInput>();
  for (const row of items) {
    wanted.set(row.ingredient_id, row);
  }

  for (const [ingredientId, it] of existingByIngredient) {
    if (!wanted.has(ingredientId)) {
      store$.dinnerItems[it.id].delete();
    }
  }

  for (const [ingredientId, row] of wanted) {
    const quantity = row.quantity ?? null;
    const unit = row.unit ?? null;
    const existing = existingByIngredient.get(ingredientId);
    if (existing) {
      if (existing.quantity !== quantity || existing.unit !== unit) {
        store$.dinnerItems[existing.id].assign({ quantity, unit, updated_at: ts });
      }
      continue;
    }
    const itemId = newId();
    store$.dinnerItems[itemId].set({
      id: itemId,
      dinner_id: dinnerId,
      ingredient_id: ingredientId,
      quantity,
      unit,
      created_at: ts,
      updated_at: ts,
    });
  }
}

/** Delete a dinner, its items, and any plan entries that referenced it (FK cascade). */
export function deleteDinner(id: string): void {
  for (const it of Object.values(store$.dinnerItems.get()).filter((i) => i.dinner_id === id)) {
    store$.dinnerItems[it.id].delete();
  }
  for (const e of Object.values(store$.planEntries.get()).filter((x) => x.dinner_id === id)) {
    store$.planEntries[e.id].delete();
  }
  store$.dinners[id].delete();
}
