/**
 * Client-side shopping-list generation from a dinner plan.
 *
 * A faithful port of the backend action
 * `food-app/app/Actions/ShoppingLists/GenerateShoppingListFromPlan.php`, so an
 * offline-generated list matches what the server would produce. Key rules
 * preserved exactly:
 *   - per entry: factor = default_servings > 0 ? servings / default_servings : 1
 *   - aggregate key is `ingredient_id | unit` (same ingredient, different unit =>
 *     separate line item; no unit conversion)
 *   - a null quantity seeds the bucket as null; later non-nulls add via (acc ?? 0)
 *     + scaled; later nulls leave the bucket unchanged
 *   - summed quantities are rounded to 2 decimals
 */
import { batch } from '@legendapp/state';

import { translate } from '@/lib/i18n';
import { store$ } from '@/lib/store/collections';
import { getLocalHouseholdId } from '@/lib/store/household';
import { newId, nowIso } from '@/lib/store/ids';
import type { LocalShoppingListItem } from '@/lib/store/schema';
import { getLocale } from '@/lib/store/settings';

export type AggregatedItem = {
  ingredient_id: string;
  unit: string | null;
  quantity: number | null;
};

export type AggregatedItemPreview = AggregatedItem & { ingredient_name: string | null };

/** Aggregate a plan's dinner ingredients into shopping-list line items. */
/**
 * Units compare trimmed and lower-cased so "g", "G" and " g" aggregate into one
 * line; blank means "no unit". Mirrors the backend's
 * `GenerateShoppingListFromPlan::normalizeUnit`.
 */
export function normalizeUnit(unit: string | null | undefined): string | null {
  const normalized = (unit ?? '').trim().toLowerCase();
  return normalized === '' ? null : normalized;
}

export function aggregatePlanItems(planId: string): AggregatedItem[] {
  const entries = Object.values(store$.planEntries.get()).filter(
    (e) => e.dinner_plan_id === planId,
  );
  const dinners = store$.dinners.get();
  const allItems = Object.values(store$.dinnerItems.get());
  const bucket = new Map<string, AggregatedItem>();

  for (const entry of entries) {
    const dinner = dinners[entry.dinner_id];
    if (!dinner) continue;
    const factor =
      dinner.default_servings > 0 ? entry.servings / dinner.default_servings : 1.0;
    for (const item of allItems.filter((i) => i.dinner_id === dinner.id)) {
      const unit = normalizeUnit(item.unit);
      const key = `${item.ingredient_id}|${unit ?? ''}`;
      const scaled = item.quantity != null ? item.quantity * factor : null;
      const current = bucket.get(key);
      if (!current) {
        bucket.set(key, { ingredient_id: item.ingredient_id, unit, quantity: scaled });
      } else if (scaled != null) {
        current.quantity = (current.quantity ?? 0) + scaled;
      }
    }
  }

  return [...bucket.values()].map((row) => ({
    ...row,
    quantity: row.quantity != null ? Math.round(row.quantity * 100) / 100 : null,
  }));
}

/** Aggregated items with ingredient names resolved, for the generate preview. */
export function previewPlanItems(planId: string): AggregatedItemPreview[] {
  const ingredients = store$.ingredients.get();
  return aggregatePlanItems(planId).map((row) => ({
    ...row,
    ingredient_name: ingredients[row.ingredient_id]?.name ?? null,
  }));
}

function addAggregatedRow(listId: string, row: AggregatedItem, ts: string): void {
  const itemId = newId();
  store$.shoppingListItems[itemId].set({
    id: itemId,
    shopping_list_id: listId,
    ingredient_id: row.ingredient_id,
    name: null,
    quantity: row.quantity,
    unit: row.unit,
    is_checked: false,
    created_at: ts,
    updated_at: ts,
  });
}

/** Create a shopping list seeded from a plan's aggregated ingredients. */
export function createShoppingListFromPlan(planId: string): string {
  const plan = store$.dinnerPlans[planId].get();
  const id = newId();
  const ts = nowIso();
  batch(() => {
    store$.shoppingLists[id].set({
      id,
      household_id: getLocalHouseholdId(),
      dinner_plan_id: planId,
      name: plan?.name ?? translate(getLocale(), 'shopping.defaultListName'),
      created_at: ts,
      updated_at: ts,
    });
    for (const row of aggregatePlanItems(planId)) {
      addAggregatedRow(id, row, ts);
    }
  });
  return id;
}

export type UpdateFromPlanResult = { added: number; updated: number };

/**
 * Bring an existing list in line with a plan's current dinners, instead of
 * generating a second list for the same week.
 *
 * Matching is by `ingredient_id | unit`, the same key the aggregation uses.
 * For each aggregated row:
 *   - no matching item → added (unchecked);
 *   - an unchecked match → its quantity is set to the plan's total (the plan
 *     is the source of truth for plan-derived quantities);
 *   - a checked match → left alone: it has been bought.
 * Items on the list that the plan no longer produces are kept — there is no
 * way to tell a stale generated row from something the user added by hand.
 */
export function updateShoppingListFromPlan(listId: string, planId: string): UpdateFromPlanResult {
  const result: UpdateFromPlanResult = { added: 0, updated: 0 };
  const ts = nowIso();
  const existing = new Map<string, LocalShoppingListItem>();
  for (const it of Object.values(store$.shoppingListItems.get())) {
    if (it.shopping_list_id !== listId || !it.ingredient_id) continue;
    // First match wins, so a duplicate line isn't touched twice.
    const key = `${it.ingredient_id}|${normalizeUnit(it.unit) ?? ''}`;
    if (!existing.has(key)) existing.set(key, it);
  }

  batch(() => {
    for (const row of aggregatePlanItems(planId)) {
      const match = existing.get(`${row.ingredient_id}|${row.unit ?? ''}`);
      if (!match) {
        addAggregatedRow(listId, row, ts);
        result.added += 1;
        continue;
      }
      if (match.is_checked || match.quantity === row.quantity) continue;
      store$.shoppingListItems[match.id].assign({ quantity: row.quantity, updated_at: ts });
      result.updated += 1;
    }
    if (result.added > 0 || result.updated > 0) {
      store$.shoppingLists[listId].updated_at.set(ts);
    }
  });
  return result;
}
