import { useValue } from '@legendapp/state/react';

import { store$ } from './collections';
import { getLocalHouseholdId } from './household';
import { newId, nowIso } from './ids';
import type { LocalIngredient } from './schema';

/** The local ingredient catalogue, alphabetised. */
export function useIngredients(): LocalIngredient[] {
  return useValue(() =>
    Object.values(store$.ingredients.get()).sort((a, b) => a.name.localeCompare(b.name)),
  );
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
 */
export function createIngredient(input: CreateIngredientInput): string {
  const name = input.name.trim();
  const existing = Object.values(store$.ingredients.get()).find(
    (i) => i.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing.id;

  const id = newId();
  const ts = nowIso();
  store$.ingredients[id].set({
    id,
    household_id: getLocalHouseholdId(),
    name,
    default_unit: input.default_unit ?? null,
    category: input.category ?? null,
    created_at: ts,
    updated_at: ts,
  });
  return id;
}
