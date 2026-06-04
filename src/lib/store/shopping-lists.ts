import { useValue } from '@legendapp/state/react';

import {
  categorize,
  coerceCategory,
  CATEGORY_ORDER,
  type CategoryId,
} from '@/lib/categorize';
import { translate } from '@/lib/i18n';

import { store$ } from './collections';
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
  ingredients: Record<string, LocalIngredient>,
): CategoryId {
  if (item.ingredient_id) {
    const ing = ingredients[item.ingredient_id];
    return (
      coerceCategory(ing?.category) ?? (ing ? categorize(ing.name) : null) ?? 'other'
    );
  }
  return categorize(item.name ?? '') ?? 'other';
}

/** Build the joined read model (ingredient name + resolved category). */
function toItemWithIngredient(
  item: LocalShoppingListItem,
  ingredients: Record<string, LocalIngredient>,
): ShoppingListItemWithIngredient {
  return {
    ...item,
    ingredient_name: item.ingredient_id ? ingredients[item.ingredient_id]?.name ?? null : null,
    category: resolveCategory(item, ingredients),
  };
}

export type ShoppingListSummary = LocalShoppingList & {
  item_count: number;
  checked_count: number;
};

/** All shopping lists, newest first, with item/checked counts. */
export function useShoppingLists(): ShoppingListSummary[] {
  return useValue(() => {
    const items = Object.values(store$.shoppingListItems.get());
    return Object.values(store$.shoppingLists.get())
      .map((list) => {
        const own = items.filter((it) => it.shopping_list_id === list.id);
        return {
          ...list,
          item_count: own.length,
          checked_count: own.filter((it) => it.is_checked).length,
        };
      })
      .sort((a, b) => compareIso(b.created_at, a.created_at));
  });
}

export function useShoppingList(id: string): LocalShoppingList | undefined {
  return useValue(() => store$.shoppingLists[id].get());
}

/**
 * A list's items, joined with the ingredient name (resolved at read time,
 * matching the server DTO). Unchecked items first, then by creation order.
 */
export function useShoppingListItems(listId: string): ShoppingListItemWithIngredient[] {
  return useValue(() => {
    const ingredients = store$.ingredients.get();
    return Object.values(store$.shoppingListItems.get())
      .filter((it) => it.shopping_list_id === listId)
      .map((it) => toItemWithIngredient(it, ingredients))
      .sort(
        (a, b) =>
          Number(a.is_checked) - Number(b.is_checked) || compareIso(a.created_at, b.created_at),
      );
  });
}

/** A list grouped into aisle sections (in {@link CATEGORY_ORDER}), plus counts. */
export type ShoppingSection = {
  id: CategoryId;
  items: ShoppingListItemWithIngredient[];
};

export type ShoppingListSections = {
  sections: ShoppingSection[];
  total: number;
  checked: number;
};

/**
 * A list's items grouped by aisle for the Listonic-style sectioned view.
 * Empty aisles are omitted; within each, unchecked items come first, then by
 * creation order. All derivation happens inside the selector (Legend-State +
 * React-Compiler safe).
 */
export function useShoppingListSections(listId: string): ShoppingListSections {
  return useValue(() => {
    const ingredients = store$.ingredients.get();
    const all = Object.values(store$.shoppingListItems.get())
      .filter((it) => it.shopping_list_id === listId)
      .map((it) => toItemWithIngredient(it, ingredients));

    const byCategory = new Map<CategoryId, ShoppingListItemWithIngredient[]>();
    for (const item of all) {
      const bucket = byCategory.get(item.category);
      if (bucket) {
        bucket.push(item);
      } else {
        byCategory.set(item.category, [item]);
      }
    }

    const sections: ShoppingSection[] = [];
    for (const id of CATEGORY_ORDER) {
      const items = byCategory.get(id);
      if (!items) continue;
      items.sort(
        (a, b) =>
          Number(a.is_checked) - Number(b.is_checked) || compareIso(a.created_at, b.created_at),
      );
      sections.push({ id, items });
    }

    return { sections, total: all.length, checked: all.filter((it) => it.is_checked).length };
  });
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
 */
export function useShoppingSuggestions(): ShoppingSuggestion[] {
  return useValue(() => {
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
  });
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
  for (const it of Object.values(store$.shoppingListItems.get()).filter(
    (i) => i.shopping_list_id === id,
  )) {
    store$.shoppingListItems[it.id].delete();
  }
  store$.shoppingLists[id].delete();
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
  item$.is_checked.set(!current);
  item$.updated_at.set(nowIso());
}

export function removeShoppingItem(itemId: string): void {
  store$.shoppingListItems[itemId].delete();
}

/** Delete every checked-off item in a list (e.g. after a shop). */
export function clearCheckedItems(listId: string): void {
  for (const it of Object.values(store$.shoppingListItems.get())) {
    if (it.shopping_list_id === listId && it.is_checked) {
      store$.shoppingListItems[it.id].delete();
    }
  }
}

/** Reset every checkbox in a list back to unchecked, to reuse it. */
export function uncheckAllItems(listId: string): void {
  const ts = nowIso();
  for (const it of Object.values(store$.shoppingListItems.get())) {
    if (it.shopping_list_id === listId && it.is_checked) {
      store$.shoppingListItems[it.id].assign({ is_checked: false, updated_at: ts });
    }
  }
}
