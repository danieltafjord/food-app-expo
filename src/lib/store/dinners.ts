import { useValue } from '@legendapp/state/react';

import { store$ } from './collections';
import { getLocalHouseholdId } from './household';
import { newId, nowIso } from './ids';
import type { DinnerWithItems, LocalDinnerItem } from './schema';

const DEFAULT_SERVINGS = 4;

function itemsForDinner(
  allItems: Record<string, LocalDinnerItem>,
  dinnerId: string,
): LocalDinnerItem[] {
  return Object.values(allItems)
    .filter((it) => it.dinner_id === dinnerId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** All dinners (recipes) with their items, alphabetised. */
export function useDinners(): DinnerWithItems[] {
  return useValue(() => {
    const itemsById = store$.dinnerItems.get();
    return Object.values(store$.dinners.get())
      .map((d) => ({ ...d, items: itemsForDinner(itemsById, d.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
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
    default_servings: input.default_servings ?? DEFAULT_SERVINGS,
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
  /** Replaces the dinner's items wholesale. */
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

/** Replace a dinner's items wholesale — mirrors the server's `syncItems`. */
export function setDinnerItems(dinnerId: string, items: DinnerItemInput[]): void {
  const ts = nowIso();
  const existing = Object.values(store$.dinnerItems.get()).filter(
    (it) => it.dinner_id === dinnerId,
  );
  for (const it of existing) {
    store$.dinnerItems[it.id].delete();
  }
  for (const row of items) {
    const itemId = newId();
    store$.dinnerItems[itemId].set({
      id: itemId,
      dinner_id: dinnerId,
      ingredient_id: row.ingredient_id,
      quantity: row.quantity ?? null,
      unit: row.unit ?? null,
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
