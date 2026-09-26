import { batch } from '@legendapp/state';
import { addDays, dateKeyOf, fromDateKey, toDateKey } from '@/lib/week';
import { hasExcludedIngredient } from '@/lib/ingredient-exclusions';
import { mealNameKey, type SuggestedDinner } from '@/lib/week-suggestions';
import { store$ } from './collections';
import { createDinner, deleteDinner, dinnerItemsOf, upsertDinnerItem } from './dinners';
import { derivedById } from './derived';
import { compareIds } from './ids';
import { createIngredient } from './ingredients';
import { createPlanEntry, ensurePlanForWeek, updatePlanEntry } from './plans';
import { getWeekPlanningContext } from './week-planning';

/** Detached recipes bind a preview to exactly what the user reviewed, including ingredient quantities. */
export function getSuggestionContext(weekStart: string, today = toDateKey(new Date())) {
  const planning = getWeekPlanningContext(weekStart, today);
  const recipes: SuggestedDinner[] = [];
  // One tracked read of each table, not one per dinner and ingredient.
  const dinners = store$.dinners.get();
  const ingredientRows = store$.ingredients.get();
  const householdId = store$.meta.localHouseholdId.get();
  const excludedIngredients = store$.households[householdId].excluded_ingredients.get() ?? [];
  const planIds = new Set(Object.values(store$.dinnerPlans.get())
    .filter((plan) => plan.household_id === householdId).map((plan) => plan.id));
  const weekEnd = toDateKey(addDays(fromDateKey(weekStart), 6));
  const plannedDinnerIds = new Set(Object.values(store$.planEntries.get())
    .filter((entry) => planIds.has(entry.dinner_plan_id) && dateKeyOf(entry.scheduled_date) >= weekStart
      && dateKeyOf(entry.scheduled_date) <= weekEnd).map((entry) => entry.dinner_id));
  const plannedIngredients = [...new Set([...plannedDinnerIds].flatMap((id) => dinnerItemsOf(id)
    .map((item) => ingredientRows[item.ingredient_id]?.name ?? '').filter(Boolean)))];
  for (const candidate of [...planning.candidates].sort((a, b) => b.weight - a.weight)) {
    const dinner = dinners[candidate.id]!;
    const ingredients = dinnerItemsOf(candidate.id).map((item) => ({
      name: ingredientRows[item.ingredient_id]?.name ?? '', quantity: item.quantity ?? 0, unit: item.unit,
    }));
    if (!ingredients.length || ingredients.some((item) => !item.name || item.quantity <= 0)
      || hasExcludedIngredient(ingredients.map((item) => item.name), excludedIngredients)) continue;
    recipes.push({ existingId: dinner.id, name: dinner.name, category: dinner.category, notes: dinner.notes,
      baseServings: dinner.default_servings, ingredients });
  }
  const allNames = Object.values(dinners)
    .filter((dinner) => dinner.household_id === store$.meta.localHouseholdId.get()).map((dinner) => dinner.name);
  return { ...planning, recipes, allNames, plannedIngredients, excludedIngredients,
    key: JSON.stringify([planning.key, store$.meta.serverHouseholdId.get(), recipes, plannedIngredients, excludedIngredients]) };
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

/** A dinner the planner chose for a day, with that day's servings. */
export type SuggestedEntry = { date: string; dinner: SuggestedDinner; servings: number };

/** What the planner wrote for a dinner; any edit since then changes it. */
function recipeFingerprint(dinnerId: string): string | null {
  const dinner = store$.dinners[dinnerId].peek();
  if (!dinner) return null;
  const items = Object.values(store$.dinnerItems.peek())
    .filter((item) => item.dinner_id === dinnerId)
    .map((item) => [item.ingredient_id, item.quantity == null ? null : Number(item.quantity), item.unit])
    .sort((a, b) => compareIds(JSON.stringify(a), JSON.stringify(b)));
  return JSON.stringify([dinner.name, dinner.notes, dinner.category, dinner.default_servings,
    dinner.emoji, dinner.image_path, !!store$.meta.pendingImages[dinnerId].peek(), items]);
}

/**
 * The dinner id to plan for a suggestion: the saved recipe it names, or a new
 * recipe written from it. A dinner by the same name that appeared meanwhile
 * (another device, an earlier suggestion) is used instead of a duplicate.
 */
function saveSuggestedDinner(dinner: SuggestedDinner): string | null {
  if (dinner.existingId) return store$.dinners[dinner.existingId].peek() ? dinner.existingId : null;
  const householdId = store$.meta.localHouseholdId.peek();
  const key = mealNameKey(dinner.name);
  const same = Object.values(store$.dinners.peek())
    .find((row) => row.household_id === householdId && mealNameKey(row.name) === key);
  if (same) return same.id;
  const id = createDinner({ name: dinner.name.trim(), default_servings: dinner.baseServings,
    category: dinner.category, notes: dinner.notes });
  for (const item of dinner.ingredients) {
    const ingredientId = createIngredient({ name: item.name, default_unit: item.unit });
    upsertDinnerItem(id, { ingredient_id: ingredientId, quantity: item.quantity, unit: item.unit });
  }
  store$.meta.suggestedDinners[id].set(recipeFingerprint(id)!);
  return id;
}

/** Plan suggestions on their days in the week's plan. Returns the new entry ids. */
export function planSuggestedDinners(weekStart: string, planName: string, entries: SuggestedEntry[]): string[] {
  const ids: string[] = [];
  if (!entries.length) return ids;
  batch(() => {
    const planId = ensurePlanForWeek(weekStart, toDateKey(addDays(fromDateKey(weekStart), 6)), planName);
    for (const { date, dinner, servings } of entries) {
      const dinnerId = saveSuggestedDinner(dinner);
      if (dinnerId) ids.push(createPlanEntry(planId, { dinner_id: dinnerId, scheduled_date: date, servings }));
    }
  });
  return ids;
}

/** Swap a planned day's dinner for a suggestion, keeping its day and servings. */
export function replacePlannedDinner(entryId: string, dinner: SuggestedDinner, today = toDateKey(new Date())): boolean {
  const entry = store$.planEntries[entryId].peek();
  if (!entry) return false;
  // Copied out: the peeked row is the live object the update below changes.
  const previous = entry.dinner_id;
  const date = dateKeyOf(entry.scheduled_date);
  let replaced = false;
  batch(() => {
    const dinnerId = saveSuggestedDinner(dinner);
    if (!dinnerId || dinnerId === previous) return;
    updatePlanEntry(entryId, { dinner_id: dinnerId });
    releaseSuggestedDinner(previous, date, today);
    replaced = true;
  });
  return replaced;
}

/**
 * After a dinner left a day (swapped out, removed, or undone): a planner-made
 * recipe that nobody changed and nothing else plans was only ever a suggestion,
 * so it goes. One someone edited, or a past day's (it was cooked), is kept.
 */
export function releaseSuggestedDinner(dinnerId: string, date: string, today = toDateKey(new Date())): void {
  const fingerprint = store$.meta.suggestedDinners[dinnerId].peek();
  if (fingerprint === undefined) return;
  if (Object.values(store$.planEntries.peek()).some((entry) => entry.dinner_id === dinnerId)) return;
  store$.meta.suggestedDinners[dinnerId].delete();
  if (date >= today && recipeFingerprint(dinnerId) === fingerprint) deleteDinner(dinnerId);
}

/** Whether the planner made this dinner and it hasn't been changed since. */
export function isUntouchedSuggestion(dinnerId: string): boolean {
  const fingerprint = store$.meta.suggestedDinners[dinnerId].peek();
  return fingerprint !== undefined && recipeFingerprint(dinnerId) === fingerprint;
}
