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
import { useValue } from '@legendapp/state/react';

import { translate } from '@/lib/i18n';
import { uniqueDinnerItems } from '@/lib/store/dinners';
import { planIdsForWeekOf } from '@/lib/store/plans';
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
  const planIds = planIdsForWeekOf(planId);
  const entries = Object.values(store$.planEntries.get()).filter(
    (e) => planIds.has(e.dinner_plan_id),
  );
  const dinners = store$.dinners.get();
  const allItems = uniqueDinnerItems(Object.values(store$.dinnerItems.get()));
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

/**
 * Names of the plan's dinners that have no ingredients at all — they contribute
 * nothing to a generated list, which is worth telling the user before creating one.
 */
export function dinnersWithoutIngredients(planId: string): string[] {
  const withItems = new Set<string>();
  for (const it of Object.values(store$.dinnerItems.get())) withItems.add(it.dinner_id);
  const dinners = store$.dinners.get();
  const names = new Set<string>();
  const planIds = planIdsForWeekOf(planId);
  for (const entry of Object.values(store$.planEntries.get())) {
    if (!planIds.has(entry.dinner_plan_id) || withItems.has(entry.dinner_id)) continue;
    const name = dinners[entry.dinner_id]?.name;
    if (name) names.add(name);
  }
  return [...names];
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
    is_generated: true,
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

export type UpdateFromPlanResult = { added: number; updated: number; removed: number };

const NO_CHANGES: UpdateFromPlanResult = { added: 0, updated: 0, removed: 0 };

type PlanDiff = UpdateFromPlanResult & {
  adds: AggregatedItem[];
  quantityUpdates: { itemId: string; quantity: number | null }[];
  removals: string[];
};

/** Bought quantities and manual additions count toward the plan and are never rewritten. */
function diffPlan(listId: string, planId: string): PlanDiff {
  const existing = new Map<string, LocalShoppingListItem[]>();
  for (const item of Object.values(store$.shoppingListItems.get())) {
    if (item.shopping_list_id !== listId || !item.ingredient_id) continue;
    const key = `${item.ingredient_id}|${normalizeUnit(item.unit) ?? ''}`;
    existing.set(key, [...(existing.get(key) ?? []), item]);
  }
  const diff: PlanDiff = { added: 0, updated: 0, removed: 0, adds: [], quantityUpdates: [], removals: [] };
  for (const row of aggregatePlanItems(planId)) {
    const key = `${row.ingredient_id}|${row.unit ?? ''}`;
    const matches = existing.get(key) ?? [];
    existing.delete(key);
    const reserved = matches.filter((item) => item.is_checked || !item.is_generated);
    const generated = matches.filter((item) => !item.is_checked && item.is_generated).sort((a, b) => a.id.localeCompare(b.id));
    const covered = reserved.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
    const quantity = row.quantity == null ? (reserved.length ? 0 : null) : Math.max(0, Math.round((row.quantity - covered) * 100) / 100);
    if (quantity === 0) {
      diff.removals.push(...generated.map((item) => item.id));
      continue;
    }
    const match = generated[0];
    if (!match) diff.adds.push({ ...row, quantity });
    else if (match.quantity !== quantity) diff.quantityUpdates.push({ itemId: match.id, quantity });
    diff.removals.push(...generated.slice(1).map((item) => item.id));
  }
  for (const matches of existing.values()) {
    diff.removals.push(...matches.filter((item) => item.is_generated && !item.is_checked).map((item) => item.id));
  }
  diff.added = diff.adds.length;
  diff.updated = diff.quantityUpdates.length;
  diff.removed = diff.removals.length;
  return diff;
}

/** Counts of what updating `listId` from `planId` would add/change (no writes). */
export function diffShoppingListFromPlan(listId: string, planId: string): UpdateFromPlanResult {
  const { added, updated, removed } = diffPlan(listId, planId);
  return { added, updated, removed };
}

/**
 * Reactive: how far the list generated from `planId` has drifted from the
 * plan. `{0, 0, 0}` (a shared constant, so it never re-renders on its own) when
 * they agree or when the list wasn't generated from a plan.
 */
export function usePlanListDrift(
  listId: string,
  planId: string | null | undefined,
): UpdateFromPlanResult {
  return useValue(() => {
    if (!planId) return NO_CHANGES;
    const { added, updated, removed } = diffPlan(listId, planId);
    return added === 0 && updated === 0 && removed === 0 ? NO_CHANGES : { added, updated, removed };
  });
}

/**
 * Bring an existing list in line with a plan's current dinners, instead of
 * generating a second list for the same week. See {@link diffPlan} for the rules.
 */
export function updateShoppingListFromPlan(listId: string, planId: string): UpdateFromPlanResult {
  const diff = diffPlan(listId, planId);
  const ts = nowIso();
  batch(() => {
    for (const row of diff.adds) addAggregatedRow(listId, row, ts);
    for (const { itemId, quantity } of diff.quantityUpdates) {
      store$.shoppingListItems[itemId].assign({ quantity, updated_at: ts });
    }
    for (const id of diff.removals) store$.shoppingListItems[id].delete();
    if (diff.added > 0 || diff.updated > 0 || diff.removed > 0) {
      store$.shoppingLists[listId].updated_at.set(ts);
    }
  });
  return { added: diff.added, updated: diff.updated, removed: diff.removed };
}
