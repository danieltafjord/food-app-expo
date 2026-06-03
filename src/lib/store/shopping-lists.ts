import { useValue } from '@legendapp/state/react';

import { store$ } from './collections';
import { getLocalHouseholdId } from './household';
import { newId, nowIso } from './ids';
import type { LocalShoppingList, ShoppingListItemWithIngredient } from './schema';

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
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
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
      .map((it) => ({
        ...it,
        ingredient_name: it.ingredient_id ? ingredients[it.ingredient_id]?.name ?? null : null,
      }))
      .sort(
        (a, b) =>
          Number(a.is_checked) - Number(b.is_checked) || a.created_at.localeCompare(b.created_at),
      );
  });
}

export function createShoppingList(name: string): string {
  const id = newId();
  const ts = nowIso();
  store$.shoppingLists[id].set({
    id,
    household_id: getLocalHouseholdId(),
    dinner_plan_id: null,
    name: name.trim() || 'Shopping list',
    created_at: ts,
    updated_at: ts,
  });
  return id;
}

export function renameShoppingList(id: string, name: string): void {
  const list$ = store$.shoppingLists[id];
  if (!list$.get()) return;
  list$.assign({ name: name.trim() || 'Shopping list', updated_at: nowIso() });
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
