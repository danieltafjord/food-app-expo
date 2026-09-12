import { batch } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';

import {
  categorize,
  coerceCategory,
  CATEGORY_ORDER,
  type CategoryId,
} from '@/lib/categorize';
import { translate } from '@/lib/i18n';

import { store$ } from './collections';
import { derived, derivedById } from './derived';
import { getLocale } from './settings';
import { getLocalHouseholdId } from './household';
import { compareIso, newId, nowIso } from './ids';
import { createIngredient, setIngredientCategory } from './ingredients';
import type {
  LocalIngredient,
  LocalShoppingList,
  LocalShoppingListItem,
  ShoppingListItemWithIngredient,
} from './schema';

/**
 * Resolve an item's aisle: a stored ingredient category wins, else re-derive
 * from the ingredient or free-text name, else `other`. Pure helper shared by
 * the read hooks.
 */
function resolveCategory(
  item: LocalShoppingListItem,
  ingredient: LocalIngredient | undefined,
): CategoryId {
  if (item.ingredient_id) {
    return (
      coerceCategory(ingredient?.category) ??
      (ingredient ? categorize(ingredient.name) : null) ??
      'other'
    );
  }
  return categorize(item.name ?? '') ?? 'other';
}

/** Build the joined read model (ingredient name + resolved category). */
function toItemWithIngredient(
  item: LocalShoppingListItem,
  ingredient: LocalIngredient | undefined,
): ShoppingListItemWithIngredient {
  return {
    ...item,
    ingredient_name: item.ingredient_id ? ingredient?.name ?? null : null,
    category: resolveCategory(item, ingredient),
  };
}

function lookupIngredient(
  ingredients: Record<string, LocalIngredient>,
  item: LocalShoppingListItem,
): LocalIngredient | undefined {
  return item.ingredient_id ? ingredients[item.ingredient_id] : undefined;
}

export type ShoppingListSummary = LocalShoppingList & {
  item_count: number;
  checked_count: number;
};

/** All shopping lists, newest first, with item/checked counts. */
const shoppingLists$ = derived((): ShoppingListSummary[] => {
  const counts = new Map<string, { item_count: number; checked_count: number }>();
  for (const it of Object.values(store$.shoppingListItems.get())) {
    let c = counts.get(it.shopping_list_id);
    if (!c) {
      c = { item_count: 0, checked_count: 0 };
      counts.set(it.shopping_list_id, c);
    }
    c.item_count += 1;
    if (it.is_checked) c.checked_count += 1;
  }
  return Object.values(store$.shoppingLists.get())
    .map((list) => ({ ...list, ...(counts.get(list.id) ?? { item_count: 0, checked_count: 0 }) }))
    .sort((a, b) => compareIso(b.created_at, a.created_at));
});

export function useShoppingLists(): ShoppingListSummary[] {
  return useValue(shoppingLists$);
}

/**
 * The most recent list generated from a plan (`dinner_plan_id`), if any — lets
 * the generate screen offer "open / update" instead of creating a duplicate.
 */
export function useShoppingListForPlan(planId: string | undefined): LocalShoppingList | undefined {
  return useValue(() => {
    if (!planId) return undefined;
    let newest: LocalShoppingList | undefined;
    for (const list of Object.values(store$.shoppingLists.get())) {
      if (list.dinner_plan_id !== planId) continue;
      if (!newest || compareIso(list.created_at, newest.created_at) > 0) newest = list;
    }
    return newest;
  });
}

export function useShoppingList(id: string): LocalShoppingList | undefined {
  return useValue(() => store$.shoppingLists[id].get());
}

/**
 * A list's items, joined with the ingredient name (resolved at read time,
 * matching the server DTO). Unchecked items first, then by creation order.
 */
const listItemsFor = derivedById((listId): ShoppingListItemWithIngredient[] => {
  const ingredients = store$.ingredients.get();
  return Object.values(store$.shoppingListItems.get())
    .filter((it) => it.shopping_list_id === listId)
    .map((it) => toItemWithIngredient(it, lookupIngredient(ingredients, it)))
    .sort(
      (a, b) =>
        Number(a.is_checked) - Number(b.is_checked) || compareIso(a.created_at, b.created_at),
    );
});

export function useShoppingListItems(listId: string): ShoppingListItemWithIngredient[] {
  return useValue(listItemsFor(listId));
}

/**
 * One item joined with its ingredient (undefined once deleted). Tracks only
 * this row and its own ingredient, so a row component using it re-renders for
 * its own edits and nothing else.
 */
export function useShoppingItem(itemId: string | undefined): ShoppingListItemWithIngredient | undefined {
  return useValue(() => {
    if (!itemId) return undefined;
    const item = store$.shoppingListItems[itemId].get();
    if (!item) return undefined;
    const ingredient = item.ingredient_id ? store$.ingredients[item.ingredient_id].get() : undefined;
    return toItemWithIngredient(item, ingredient);
  });
}

/** A list grouped into aisle sections (in {@link CATEGORY_ORDER}), plus counts. */
export type ShoppingSection = {
  id: CategoryId;
  /** Row ids in display order; rows subscribe to their own data via `useShoppingItem`. */
  itemIds: string[];
};

export type ShoppingListSections = {
  /** Unchecked items, grouped by aisle. */
  sections: ShoppingSection[];
  /** Checked items in the order they were ticked off, shown as one group at the end. */
  checkedIds: string[];
  total: number;
  checked: number;
};

/**
 * Per-list cache of the last sections result keyed by its structural shape.
 * `useValue` re-renders whenever the selector returns a new reference, and the
 * selector re-runs on *any* change to the items map. Returning the previous
 * object when the shape (ids, order, counts) is unchanged means a quantity edit
 * or a rename re-renders only the row that subscribes to it, not the screen.
 */
const sectionsCache = new Map<string, { key: string; value: ShoppingListSections }>();

/**
 * A list's items grouped by aisle for the Listonic-style sectioned view.
 * Empty aisles are omitted. Checked items leave their aisle and collect in one
 * group at the end (most recently ticked last), so the part of the list still
 * to shop keeps getting shorter. Returns ids only — see
 * {@link ShoppingSection.itemIds}. All derivation happens inside the selector
 * (Legend-State + React-Compiler safe).
 */
const sectionsFor = derivedById((listId): ShoppingListSections => {
  const ingredients = store$.ingredients.get();
  const byCategory = new Map<CategoryId, ShoppingListItemWithIngredient[]>();
  const checkedItems: LocalShoppingListItem[] = [];
  let total = 0;
  let checked = 0;
  for (const it of Object.values(store$.shoppingListItems.get())) {
    if (it.shopping_list_id !== listId) continue;
    total += 1;
    if (it.is_checked) {
      checked += 1;
      checkedItems.push(it);
      continue;
    }
    const item = toItemWithIngredient(it, lookupIngredient(ingredients, it));
    const bucket = byCategory.get(item.category);
    if (bucket) {
      bucket.push(item);
    } else {
      byCategory.set(item.category, [item]);
    }
  }

  const sections: ShoppingSection[] = [];
  const keyParts: string[] = [];
  for (const id of CATEGORY_ORDER) {
    const items = byCategory.get(id);
    if (!items) continue;
    items.sort((a, b) => compareIso(a.created_at, b.created_at));
    const itemIds = items.map((it) => it.id);
    sections.push({ id, itemIds });
    keyParts.push(`${id}:${itemIds.join(',')}`);
  }
  // Ticking sets updated_at, so this is "in the order they were checked".
  checkedItems.sort((a, b) => compareIso(a.updated_at, b.updated_at));
  const checkedIds = checkedItems.map((it) => it.id);

  const key = `${total}/${checked}|${keyParts.join(';')}|${checkedIds.join(',')}`;
  const cached = sectionsCache.get(listId);
  if (cached && cached.key === key) return cached.value;
  const value = { sections, checkedIds, total, checked };
  sectionsCache.set(listId, { key, value });
  return value;
});

export function useShoppingListSections(listId: string): ShoppingListSections {
  return useValue(sectionsFor(listId));
}

export type ShoppingSuggestion = {
  /** Stable identity for React keys + de-dupe (ingredient id, or `txt:<name>`). */
  key: string;
  name: string;
  ingredient_id: string | null;
  default_unit: string | null;
  /** How many times this has appeared on any list — drives ordering. */
  usage_count: number;
};

/**
 * The household's quick-add catalogue: every ingredient plus any free-text item
 * ever put on a list, de-duped by name (case-insensitive) and ordered by how
 * often it's been used, then alphabetically. This is the "previous items"
 * source the Listonic-style add screen picks from.
 *
 * Non-reactive on purpose: it walks every item ever created, and the add
 * screen snapshots it once on open (`useState(buildShoppingSuggestions)`) so
 * the catalogue doesn't reorder under the finger — and isn't rebuilt — on
 * every tap.
 */
export function buildShoppingSuggestions(): ShoppingSuggestion[] {
  const ingredients = store$.ingredients.get();
  const byName = new Map<string, ShoppingSuggestion>();

  for (const ing of Object.values(ingredients)) {
    byName.set(ing.name.toLowerCase(), {
      key: ing.id,
      name: ing.name,
      ingredient_id: ing.id,
      default_unit: ing.default_unit,
      usage_count: 0,
    });
  }

  for (const it of Object.values(store$.shoppingListItems.get())) {
    const ingredient = it.ingredient_id ? ingredients[it.ingredient_id] : undefined;
    const name = ingredient ? ingredient.name : it.name?.trim();
    if (!name) continue;
    const lname = name.toLowerCase();
    const existing = byName.get(lname);
    if (existing) {
      existing.usage_count += 1;
    } else {
      byName.set(lname, {
        key: `txt:${lname}`,
        name,
        ingredient_id: null,
        default_unit: it.unit ?? null,
        usage_count: 1,
      });
    }
  }

  return Array.from(byName.values()).sort(
    (a, b) => b.usage_count - a.usage_count || a.name.localeCompare(b.name),
  );
}

/** Fallback name for an unnamed list, in the active language. */
function defaultListName(): string {
  return translate(getLocale(), 'shopping.defaultListName');
}

export function createShoppingList(name: string): string {
  const id = newId();
  const ts = nowIso();
  store$.shoppingLists[id].set({
    id,
    household_id: getLocalHouseholdId(),
    dinner_plan_id: null,
    name: name.trim() || defaultListName(),
    created_at: ts,
    updated_at: ts,
  });
  return id;
}

export function renameShoppingList(id: string, name: string): void {
  const list$ = store$.shoppingLists[id];
  if (!list$.get()) return;
  list$.assign({ name: name.trim() || defaultListName(), updated_at: nowIso() });
}

export function deleteShoppingList(id: string): void {
  // One notification for the whole delete: every subscriber (sections, list
  // counts, sync outbox) would otherwise re-run once per row.
  batch(() => {
    for (const it of Object.values(store$.shoppingListItems.get())) {
      if (it.shopping_list_id === id) store$.shoppingListItems[it.id].delete();
    }
    store$.shoppingLists[id].delete();
  });
  sectionsCache.delete(id);
}

export type ShoppingItemInput = {
  ingredient_id?: string | null;
  name?: string | null;
  quantity?: number | null;
  unit?: string | null;
};

export function addShoppingItem(listId: string, input: ShoppingItemInput): string {
  const id = newId();
  const ts = nowIso();
  store$.shoppingListItems[id].set({
    id,
    shopping_list_id: listId,
    ingredient_id: input.ingredient_id ?? null,
    name: input.name ?? null,
    quantity: input.quantity ?? null,
    unit: input.unit ?? null,
    is_checked: false,
    created_at: ts,
    updated_at: ts,
  });
  return id;
}

export function updateShoppingItem(itemId: string, patch: ShoppingItemInput): void {
  const item$ = store$.shoppingListItems[itemId];
  if (!item$.get()) return;
  item$.assign({ ...patch, updated_at: nowIso() });
}

/**
 * Move an item to a different aisle. For an ingredient-backed item this updates
 * the ingredient's category (remembered + synced). A free-text item is promoted
 * to a real ingredient carrying the chosen category — the same thing the add
 * flow does — so the choice sticks and shows up as a future suggestion.
 */
export function recategorizeShoppingItem(itemId: string, category: CategoryId): void {
  const item = store$.shoppingListItems[itemId].get();
  if (!item) return;

  if (item.ingredient_id) {
    setIngredientCategory(item.ingredient_id, category);
    return;
  }

  const name = item.name?.trim();
  if (!name) return;
  const ingredientId = createIngredient({ name, default_unit: item.unit, category });
  setIngredientCategory(ingredientId, category);
  updateShoppingItem(itemId, { ingredient_id: ingredientId, name: null });
}

export function toggleShoppingItem(itemId: string): void {
  const item$ = store$.shoppingListItems[itemId];
  const current = item$.is_checked.get();
  if (current === undefined) return;
  item$.assign({ is_checked: !current, updated_at: nowIso() });
}

export function removeShoppingItem(itemId: string): void {
  store$.shoppingListItems[itemId].delete();
}

/** Delete every checked-off item in a list (e.g. after a shop). */
export function clearCheckedItems(listId: string): void {
  batch(() => {
    for (const it of Object.values(store$.shoppingListItems.get())) {
      if (it.shopping_list_id === listId && it.is_checked) {
        store$.shoppingListItems[it.id].delete();
      }
    }
  });
}

/** Reset every checkbox in a list back to unchecked, to reuse it. */
export function uncheckAllItems(listId: string): void {
  const ts = nowIso();
  batch(() => {
    for (const it of Object.values(store$.shoppingListItems.get())) {
      if (it.shopping_list_id === listId && it.is_checked) {
        store$.shoppingListItems[it.id].assign({ is_checked: false, updated_at: ts });
      }
    }
  });
}
