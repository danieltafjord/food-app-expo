import type { SuggestedDinner } from '@/lib/week-suggestions';
import { clearLocalData, resetLocalDataForHousehold } from './account';
import { store$ } from './collections';
import { createDinner, getDinner, patchDinner, upsertDinnerItem } from './dinners';
import { createIngredient } from './ingredients';
import { createDinnerPlan, createPlanEntry, deletePlanEntry } from './plans';
import {
  getSuggestionContext,
  isUntouchedSuggestion,
  planSuggestedDinners,
  releaseSuggestedDinner,
  replacePlannedDinner,
} from './week-suggestions';

const WEEK = '2026-09-21';
const TODAY = '2026-09-24';
const recipe = (name = 'Tomato pasta'): SuggestedDinner => ({ existingId: null, name, category: 'vegetarian',
  notes: 'Cook the pasta and simmer the tomatoes.', baseServings: 2,
  ingredients: [{ name: 'Pasta', quantity: 200, unit: 'g' }, { name: 'Tomato', quantity: 300, unit: 'g' }] });
const entries = () => Object.values(store$.planEntries.get());
const dinnerNames = () => Object.values(store$.dinners.get()).map((row) => row.name).sort();

beforeEach(() => clearLocalData());

it('writes new recipes and plans each day with its own servings', () => {
  const ids = planSuggestedDinners(WEEK, 'Week', [
    { date: TODAY, dinner: recipe(), servings: 2 },
    { date: '2026-09-26', dinner: recipe('Pasta bake'), servings: 4 },
  ]);
  expect(ids).toHaveLength(2);
  expect(dinnerNames()).toEqual(['Pasta bake', 'Tomato pasta']);
  expect(entries().map((row) => [row.scheduled_date, row.servings]).sort()).toEqual([[TODAY, 2], ['2026-09-26', 4]]);
  const dinner = getDinner(entries().find((row) => row.scheduled_date === TODAY)!.dinner_id)!;
  expect(dinner).toMatchObject({ notes: 'Cook the pasta and simmer the tomatoes.', default_servings: 2, category: 'vegetarian' });
  expect(dinner.items.map((item) => [item.quantity, item.unit])).toEqual([[200, 'g'], [300, 'g']]);
  // Both recipes share one catalogue entry per ingredient.
  expect(Object.values(store$.ingredients.get())).toHaveLength(2);
  expect(Object.values(store$.dinnerPlans.get())).toHaveLength(1);
});

it('plans a saved recipe by id without rewriting it, and never duplicates a dinner by name', () => {
  const id = createDinner({ name: 'Family pasta', default_servings: 4 });
  upsertDinnerItem(id, { ingredient_id: createIngredient({ name: 'Pasta' }), quantity: 400, unit: 'g' });
  const original = JSON.stringify(getDinner(id));
  const saved = getSuggestionContext(WEEK, TODAY).recipes[0];
  planSuggestedDinners(WEEK, 'Week', [
    { date: TODAY, dinner: saved, servings: 2 },
    // Generated elsewhere under a name the household already has.
    { date: '2026-09-25', dinner: recipe(' family PASTA '), servings: 2 },
  ]);
  expect(entries().map((row) => row.dinner_id)).toEqual([id, id]);
  expect(JSON.stringify(getDinner(id))).toBe(original);
  expect(isUntouchedSuggestion(id)).toBe(false);
});

it('skips a saved recipe deleted before its suggestion arrived', () => {
  const id = createDinner({ name: 'Gone soon' });
  const dinner: SuggestedDinner = { ...recipe('Gone soon'), existingId: id };
  store$.dinners[id].delete();
  expect(planSuggestedDinners(WEEK, 'Week', [{ date: TODAY, dinner, servings: 2 }])).toEqual([]);
  expect(entries()).toEqual([]);
});

it('swaps a day\'s dinner and deletes the suggestion it replaced', () => {
  const [entryId] = planSuggestedDinners(WEEK, 'Week', [{ date: TODAY, dinner: recipe(), servings: 3 }]);
  const first = entries()[0].dinner_id;
  expect(isUntouchedSuggestion(first)).toBe(true);

  expect(replacePlannedDinner(entryId, recipe('Fish soup'), TODAY)).toBe(true);
  expect(store$.planEntries[entryId].get()).toMatchObject({ scheduled_date: TODAY, servings: 3 });
  expect(dinnerNames()).toEqual(['Fish soup']);
  expect(Object.values(store$.dinnerItems.get())).not.toContainEqual(expect.objectContaining({ dinner_id: first }));
  expect(store$.meta.suggestedDinners[first].get()).toBeUndefined();
});

it.each([
  ['edited', (id: string) => patchDinner(id, { notes: 'Our way' })],
  ['given a new amount', (id: string) => upsertDinnerItem(id, {
    ingredient_id: getDinner(id)!.items[0].ingredient_id, quantity: 500, unit: 'g' })],
  ['planned on another day', (id: string) => createPlanEntry(entries()[0].dinner_plan_id, {
    dinner_id: id, scheduled_date: '2026-09-27', servings: 2 })],
])('keeps a suggestion once it was %s', (_, change) => {
  const [entryId] = planSuggestedDinners(WEEK, 'Week', [{ date: TODAY, dinner: recipe(), servings: 2 }]);
  const first = entries()[0].dinner_id;
  change(first);
  replacePlannedDinner(entryId, recipe('Fish soup'), TODAY);
  expect(dinnerNames()).toEqual(['Fish soup', 'Tomato pasta']);
});

it('keeps a suggestion that was cooked on a past day, and replaced saved recipes always', () => {
  const [past] = planSuggestedDinners(WEEK, 'Week', [{ date: '2026-09-22', dinner: recipe(), servings: 2 }]);
  const cooked = store$.planEntries[past].get()!.dinner_id;
  deletePlanEntry(past);
  releaseSuggestedDinner(cooked, '2026-09-22', TODAY);
  expect(dinnerNames()).toEqual(['Tomato pasta']);

  const own = createDinner({ name: 'Our tacos' });
  const plan = createDinnerPlan({ name: 'Week', start_date: WEEK });
  const entryId = createPlanEntry(plan, { dinner_id: own, scheduled_date: TODAY, servings: 2 });
  replacePlannedDinner(entryId, recipe('Fish soup'), TODAY);
  expect(dinnerNames()).toEqual(['Fish soup', 'Our tacos', 'Tomato pasta']);
});

it('removes a suggestion taken off the plan', () => {
  const [entryId] = planSuggestedDinners(WEEK, 'Week', [{ date: TODAY, dinner: recipe(), servings: 2 }]);
  const dinnerId = store$.planEntries[entryId].get()!.dinner_id;
  deletePlanEntry(entryId);
  releaseSuggestedDinner(dinnerId, TODAY, TODAY);
  expect(store$.dinners.get()).toEqual({});
});

it('clears personal preferences and suggestion bookkeeping when switching household', () => {
  store$.meta.planningPreferences.set({ text: 'No fish', shortcuts: ['quick'], excluded: ['Fish soup'], source: 'new' });
  planSuggestedDinners(WEEK, 'Week', [{ date: TODAY, dinner: recipe(), servings: 2 }]);
  resetLocalDataForHousehold(12);
  expect(store$.meta.planningPreferences.get()).toEqual({ text: '', shortcuts: [], excluded: [] });
  expect(store$.meta.suggestedDinners.get()).toEqual({});
});

it('leaves out saved recipes with household exclusions', () => {
  const id = createDinner({ name: 'Family pasta' });
  upsertDinnerItem(id, { ingredient_id: createIngredient({ name: 'Pasta' }), quantity: 200, unit: 'g' });
  expect(getSuggestionContext(WEEK, TODAY).recipes).toHaveLength(1);
  store$.households[store$.meta.localHouseholdId.get()].excluded_ingredients.set(['pasta']);
  expect(getSuggestionContext(WEEK, TODAY).recipes).toEqual([]);
});
