import { batch } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';

import { categorize, type CategoryId } from '@/lib/categorize';
import { nameCollator } from '@/lib/intl';

import { store$ } from './collections';
import { derived } from './derived';
import { getLocalHouseholdId } from './household';
import { newId, nowIso } from './ids';
import { getLocale } from './settings';
import type { LocalIngredient } from './schema';

/** The local ingredient catalogue, alphabetised. Cached until an ingredient changes. */
const ingredients$ = derived(() => {
  const { compare } = nameCollator(getLocale());
  return Object.values(store$.ingredients.get()).sort((a, b) => compare(a.name, b.name));
});

export function useIngredients(): LocalIngredient[] {
  return useValue(ingredients$);
}

export function useIngredient(id: string): LocalIngredient | undefined {
  return useValue(() => store$.ingredients[id].get());
}

export function getIngredient(id: string): LocalIngredient | undefined {
  return store$.ingredients[id].get();
}

export type CreateIngredientInput = {
  name: string;
  default_unit?: string | null;
  category?: string | null;
};

/**
 * Create an ingredient, or return the existing one with the same name
 * (case-insensitive) — mirrors the backend's `unique(household_id, name)`.
 *
 * When no category is supplied, the name is auto-categorized into an aisle
 * (`@/lib/categorize`) so the shopping list can group it; an unknown item is
 * left null and treated as "Other" at read time.
 */
export function createIngredient(input: CreateIngredientInput): string {
  const name = input.name.trim();
  const existing = Object.values(store$.ingredients.get()).find(
    (i) => i.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing.id;

  const id = newId();
  const ts = nowIso();
  const category = input.category ?? categorize(name);
  store$.ingredients[id].set({
    id,
    household_id: getLocalHouseholdId(),
    name,
    default_unit: input.default_unit ?? null,
    category,
    category_source: input.category != null ? 'user' : category ? 'dictionary' : null,
    created_at: ts,
    updated_at: ts,
  });
  return id;
}

/** Remove a catalogue entry and every recipe/shopping row that refers to it. */
export function deleteIngredient(id: string): void {
  batch(() => {
    for (const item of Object.values(store$.dinnerItems.peek())) {
      if (item.ingredient_id === id) store$.dinnerItems[item.id].delete();
    }
    for (const item of Object.values(store$.shoppingListItems.peek())) {
      if (item.ingredient_id === id) store$.shoppingListItems[item.id].delete();
    }
    store$.ingredients[id].delete();
  });
}

/**
 * Set (or clear) an ingredient's aisle category — used when the user manually
 * recategorizes an item. Persisted on the ingredient, so it's remembered for
 * future lists and synced within the household.
 */
export function setIngredientCategory(id: string, category: CategoryId | null): void {
  const ing$ = store$.ingredients[id];
  if (!ing$.get()) return;
  ing$.assign({ category, category_source: 'user', updated_at: nowIso() });
}
