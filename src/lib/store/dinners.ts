import { batch } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';

import { nameCollator } from '@/lib/intl';
import type { DinnerCategory } from '@/lib/dinner-categories';
import { dateKeyOf } from '@/lib/week';
import { store$ } from './collections';
import { derived } from './derived';
import { getHouseholdDefaultServings, getLocalHouseholdId } from './household';
import { compareIds, compareIso, newId, nowIso } from './ids';
import { getLocale } from './settings';
import type { DinnerWithItems, LocalDinner, LocalDinnerItem, LocalPlanEntry } from './schema';

function dinnerItemKey(item: { ingredient_id: string; unit?: string | null }): string {
  return `${item.ingredient_id}:${item.unit?.trim().toLowerCase() ?? ''}`;
}

export function uniqueDinnerItems(items: readonly LocalDinnerItem[]): LocalDinnerItem[] {
  const latest = new Map<string, LocalDinnerItem>();
  for (const item of items) {
    const key = `${item.dinner_id}:${dinnerItemKey(item)}`;
    const previous = latest.get(key);
    if (!previous || (compareIso(item.updated_at, previous.updated_at) || compareIds(item.id, previous.id)) > 0) {
      latest.set(key, item);
    }
  }
  return [...latest.values()];
}

const NO_ITEMS: LocalDinnerItem[] = [];

/**
 * Every dinner's (de-duplicated) items in creation order, keyed by dinner id —
 * one pass over the items table per change, shared by every reader, instead of
 * each lookup de-duplicating the whole table to find one dinner's rows.
 */
const itemsByDinner$ = derived((): Record<string, LocalDinnerItem[]> => {
  const byDinner: Record<string, LocalDinnerItem[]> = {};
  for (const it of uniqueDinnerItems(Object.values(store$.dinnerItems.get()))) {
    (byDinner[it.dinner_id] ??= []).push(it);
  }
  for (const items of Object.values(byDinner)) {
    items.sort((a, b) => compareIso(a.created_at, b.created_at));
  }
  return byDinner;
});

/** A dinner's items (tracked: re-runs a selector when any dinner item changes). */
export function dinnerItemsOf(dinnerId: string): LocalDinnerItem[] {
  return itemsByDinner$.get()[dinnerId] ?? NO_ITEMS;
}

/** All dinners (recipes) with their items, alphabetised. Cached until a dinner/item changes. */
const dinners$ = derived((): DinnerWithItems[] => {
  const byDinner = itemsByDinner$.get();
  const { compare } = nameCollator(getLocale());
  return Object.values(store$.dinners.get())
    .map((d) => ({ ...d, items: byDinner[d.id] ?? NO_ITEMS }))
    .sort((a, b) => compare(a.name, b.name));
});

export function useDinners(): DinnerWithItems[] {
  return useValue(dinners$);
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
  compareNames: (a: string, b: string) => number = (a, b) => a.localeCompare(b),
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
        // Date keys (YYYY-MM-DD) order correctly as plain strings.
        return b.last_planned < a.last_planned ? -1 : 1;
      }
      return compareNames(a.name, b.name);
    });
}

/**
 * Dinners without their items, most recently planned first — for pickers that
 * only show the name and recency, so they don't join the items collection.
 */
const dinnerOptions$ = derived(() =>
  rankByRecency(
    Object.values(store$.dinners.get()),
    Object.values(store$.planEntries.get()),
    nameCollator(getLocale()).compare,
  ),
);

export function useDinnerOptions(): DinnerOption[] {
  return useValue(dinnerOptions$);
}

/** A single dinner with its items, or undefined if it doesn't exist. */
export function useDinner(id: string): DinnerWithItems | undefined {
  return useValue(() => {
    const dinner = store$.dinners[id].get();
    return dinner ? { ...dinner, items: dinnerItemsOf(id) } : undefined;
  });
}

/** Non-reactive read of a dinner with its items (e.g. right after creating one). */
export function getDinner(id: string): DinnerWithItems | undefined {
  const dinner = store$.dinners[id].get();
  if (!dinner) return undefined;
  return { ...dinner, items: dinnerItemsOf(id) };
}

export type CreateDinnerInput = {
  name: string;
  default_servings?: number;
  notes?: string | null;
  category?: DinnerCategory | null;
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
    category: input.category ?? null,
    emoji: null,
    image_path: null,
    image_thumbhash: null,
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
  category?: DinnerCategory | null;
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
    ...(input.category !== undefined ? { category: input.category } : {}),
    updated_at: nowIso(),
  });
  setDinnerItems(id, input.items);
}

/** Change only the edited recipe fields; ingredient changes use row mutations below. */
export function patchDinner(id: string, patch: Partial<CreateDinnerInput>): void {
  if (!store$.dinners[id].peek()) return;
  store$.dinners[id].assign({ ...patch, updated_at: nowIso() });
}

export function upsertDinnerItem(dinnerId: string, input: DinnerItemInput, itemId?: string): void {
  if (!store$.dinners[dinnerId].peek()) return;
  const existing = Object.values(store$.dinnerItems.peek()).find(
    (item) => item.dinner_id === dinnerId && (itemId ? item.id === itemId :
      dinnerItemKey(item) === dinnerItemKey(input)),
  );
  // A remotely deleted row must not be recreated by a stale input event.
  if (itemId && !existing) return;
  const ts = nowIso();
  if (existing) {
    store$.dinnerItems[existing.id].assign({ quantity: input.quantity ?? null, unit: input.unit ?? null, updated_at: ts });
  } else {
    const id = newId();
    store$.dinnerItems[id].set({ id, dinner_id: dinnerId, ingredient_id: input.ingredient_id,
      quantity: input.quantity ?? null, unit: input.unit ?? null, created_at: ts, updated_at: ts });
  }
}

export function removeDinnerItem(dinnerId: string, itemId: string): void {
  const item = store$.dinnerItems[itemId].peek();
  if (!item || item.dinner_id !== dinnerId) return;
  for (const candidate of Object.values(store$.dinnerItems.peek())) {
    if (candidate.dinner_id === dinnerId && dinnerItemKey(candidate) === dinnerItemKey(item)) {
      store$.dinnerItems[candidate.id].delete();
    }
  }
}

/**
 * Set a dinner's items to exactly `items`, diffing by ingredient and unit so that an
 * unchanged ingredient keeps its row (and its id). Stable ids matter for sync:
 * delete-and-recreate would turn every save into a tombstone plus a fresh row,
 * and two devices saving the same dinner would end up with doubled items.
 * When the same ingredient/unit appears more than once, the last entry wins.
 */
export function setDinnerItems(dinnerId: string, items: DinnerItemInput[]): void {
  const ts = nowIso();
  const existingByIngredient = new Map<string, LocalDinnerItem>();
  for (const it of Object.values(store$.dinnerItems.get())) {
    if (it.dinner_id === dinnerId) {
      existingByIngredient.set(dinnerItemKey(it), it);
    }
  }

  const wanted = new Map<string, DinnerItemInput>();
  for (const row of items) {
    wanted.set(dinnerItemKey(row), row);
  }

  for (const [key, it] of existingByIngredient) {
    if (!wanted.has(key)) {
      store$.dinnerItems[it.id].delete();
    }
  }

  for (const [key, row] of wanted) {
    const quantity = row.quantity ?? null;
    const unit = row.unit ?? null;
    const existing = existingByIngredient.get(key);
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
      ingredient_id: row.ingredient_id,
      quantity,
      unit,
      created_at: ts,
      updated_at: ts,
    });
  }
}

/** Delete a dinner, its items, and any plan entries that referenced it (FK cascade). */
export function deleteDinner(id: string): void {
  // Already gone (an undoable delete committing after a remote delete).
  if (!store$.dinners[id].peek()) return;
  // One notification for the whole cascade, not one per deleted row.
  batch(() => {
    for (const it of Object.values(store$.dinnerItems.peek()).filter((i) => i.dinner_id === id)) {
      store$.dinnerItems[it.id].delete();
    }
    for (const e of Object.values(store$.planEntries.peek()).filter((x) => x.dinner_id === id)) {
      store$.planEntries[e.id].delete();
    }
    store$.meta.pendingImages[id].delete();
    store$.dinners[id].delete();
  });
}

/** What a dinner shows as its picture. Setting one kind clears the other. */
export type DinnerPicture =
  | { kind: 'emoji'; emoji: string }
  | { kind: 'image'; path: string; thumbhash: string }
  | { kind: 'none' };

export function setDinnerPicture(id: string, picture: DinnerPicture): void {
  if (!store$.dinners[id].peek()) return;
  batch(() => {
    // An explicit choice replaces a photo still waiting to upload.
    store$.meta.pendingImages[id].delete();
    store$.dinners[id].assign({
      emoji: picture.kind === 'emoji' ? picture.emoji : null,
      image_path: picture.kind === 'image' ? picture.path : null,
      image_thumbhash: picture.kind === 'image' ? picture.thumbhash : null,
      updated_at: nowIso(),
    });
  });
}
