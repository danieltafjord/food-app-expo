import { batch } from '@legendapp/state';
import { createShoppingListFromPlan, updateShoppingListFromPlan } from '@/lib/shopping/generate';
import { addDays, fromDateKey, toDateKey } from '@/lib/week';
import { mealNameKey, type SuggestedDinner } from '@/lib/week-suggestions';
import { store$ } from './collections';
import { createDinner, dinnerItemsOf, upsertDinnerItem } from './dinners';
import { derivedById } from './derived';
import { compareIds, compareIso } from './ids';
import { createIngredient } from './ingredients';
import { createPlanEntry, ensurePlanForWeek, planIdsForWeekOf } from './plans';
import { getWeekPlanningContext } from './week-planning';

export type SuggestedWeekDraft = {
  weekStart: string;
  contextKey: string;
  /** Servings are per day: a Saturday for guests can cook more than a weekday. */
  entries: { date: string; dinner: SuggestedDinner; servings: number }[];
};

/** Detached recipes bind a preview to exactly what the user reviewed, including ingredient quantities. */
export function getSuggestionContext(weekStart: string, today = toDateKey(new Date())) {
  const planning = getWeekPlanningContext(weekStart, today);
  const recipes: SuggestedDinner[] = [];
  // One tracked read of each table, not one per dinner and ingredient.
  const dinners = store$.dinners.get();
  const ingredientRows = store$.ingredients.get();
  for (const candidate of [...planning.candidates].sort((a, b) => b.weight - a.weight)) {
    const dinner = dinners[candidate.id]!;
    const ingredients = dinnerItemsOf(candidate.id).map((item) => ({
      name: ingredientRows[item.ingredient_id]?.name ?? '', quantity: item.quantity ?? 0, unit: item.unit,
    }));
    if (!ingredients.length || ingredients.some((item) => !item.name || item.quantity <= 0)) continue;
    recipes.push({ existingId: dinner.id, name: dinner.name, category: dinner.category, notes: dinner.notes,
      baseServings: dinner.default_servings, ingredients });
  }
  const allNames = Object.values(dinners)
    .filter((dinner) => dinner.household_id === store$.meta.localHouseholdId.get()).map((dinner) => dinner.name);
  return { ...planning, recipes, allNames,
    key: JSON.stringify([planning.key, store$.meta.serverHouseholdId.get(), recipes]) };
}

/**
 * The context as a computed per week and day: the sheet re-renders on every
 * keystroke and stepper tap, and this joins every candidate dinner's recipe.
 */
const suggestionContextFor = derivedById((weekAndDay) => {
  const [weekStart, today] = weekAndDay.split('|');
  return getSuggestionContext(weekStart, today);
});

export function suggestionContext$(weekStart: string, today = toDateKey(new Date())) {
  return suggestionContextFor(`${weekStart}|${today}`);
}

/** Return the prepared list, or reject the complete draft without writing anything. */
export function acceptSuggestedWeek(draft: SuggestedWeekDraft, name: string, today = toDateKey(new Date())): string | null {
  const context = getSuggestionContext(draft.weekStart, today);
  if (draft.contextKey !== context.key || !draft.entries.length || draft.entries.length > 7
    || draft.entries.some((entry) => !Number.isInteger(entry.servings) || entry.servings < 1 || entry.servings > 99)
    || new Set(draft.entries.map((entry) => entry.date)).size !== draft.entries.length
    || new Set(draft.entries.map((entry) => mealNameKey(entry.dinner.name))).size !== draft.entries.length) return null;
  for (const { date, dinner } of draft.entries) {
    if (!context.dates.includes(date) || !dinner.name.trim() || !dinner.ingredients.length
      || !Number.isInteger(dinner.baseServings) || dinner.baseServings < 1 || dinner.baseServings > 99
      || dinner.ingredients.some((item) => !item.name.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0)) return null;
    if (dinner.existingId) {
      if (!context.recipes.some((recipe) => JSON.stringify(recipe) === JSON.stringify(dinner))) return null;
    } else if (context.allNames.some((existing) => mealNameKey(existing) === mealNameKey(dinner.name))) {
      return null;
    }
  }
  let listId = '';
  batch(() => {
    const planId = ensurePlanForWeek(draft.weekStart, toDateKey(addDays(fromDateKey(draft.weekStart), 6)), name);
    for (const { date, dinner, servings } of draft.entries) {
      const dinnerId = dinner.existingId ?? createDinner({ name: dinner.name, default_servings: dinner.baseServings,
        category: dinner.category, notes: dinner.notes });
      if (!dinner.existingId) {
        for (const item of dinner.ingredients) {
          const ingredientId = createIngredient({ name: item.name, default_unit: item.unit });
          upsertDinnerItem(dinnerId, { ingredient_id: ingredientId, quantity: item.quantity, unit: item.unit });
        }
      }
      createPlanEntry(planId, { dinner_id: dinnerId, scheduled_date: date, servings });
    }
    const planIds = planIdsForWeekOf(planId);
    const list = Object.values(store$.shoppingLists.get())
      .filter((row) => row.dinner_plan_id && planIds.has(row.dinner_plan_id) && !row.archived_at)
      .sort((a, b) => compareIso(b.created_at, a.created_at) || compareIds(b.id, a.id))[0];
    if (list) {
      updateShoppingListFromPlan(list.id, planId);
      listId = list.id;
    } else listId = createShoppingListFromPlan(planId);
  });
  return listId;
}
