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
import { store$ } from '@/lib/store/collections';
import { getLocalHouseholdId } from '@/lib/store/household';
import { newId, nowIso } from '@/lib/store/ids';

export type AggregatedItem = {
  ingredient_id: string;
  unit: string | null;
  quantity: number | null;
};

export type AggregatedItemPreview = AggregatedItem & { ingredient_name: string | null };

/** Aggregate a plan's dinner ingredients into shopping-list line items. */
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
      const key = `${item.ingredient_id}|${item.unit ?? ''}`;
      const scaled = item.quantity != null ? item.quantity * factor : null;
      const current = bucket.get(key);
      if (!current) {
        bucket.set(key, { ingredient_id: item.ingredient_id, unit: item.unit, quantity: scaled });
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

/** Create a shopping list seeded from a plan's aggregated ingredients. */
export function createShoppingListFromPlan(planId: string): string {
  const plan = store$.dinnerPlans[planId].get();
  const id = newId();
  const ts = nowIso();
  store$.shoppingLists[id].set({
    id,
    household_id: getLocalHouseholdId(),
    dinner_plan_id: planId,
    name: plan?.name ?? 'Shopping list',
    created_at: ts,
    updated_at: ts,
  });
  for (const row of aggregatePlanItems(planId)) {
    const itemId = newId();
    store$.shoppingListItems[itemId].set({
      id: itemId,
      shopping_list_id: id,
      ingredient_id: row.ingredient_id,
      name: null,
      quantity: row.quantity,
      unit: row.unit,
      is_checked: false,
      created_at: ts,
      updated_at: ts,
    });
  }
  return id;
}
