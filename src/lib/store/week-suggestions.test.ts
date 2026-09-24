import { createShoppingListFromPlan } from '@/lib/shopping/generate';
import type { SuggestedDinner } from '@/lib/week-suggestions';
import { clearLocalData, resetLocalDataForHousehold } from './account';
import { store$ } from './collections';
import { createDinner, getDinner, upsertDinnerItem } from './dinners';
import { createIngredient } from './ingredients';
import { createDinnerPlan, createPlanEntry } from './plans';
import { addShoppingItem, toggleShoppingItem } from './shopping-lists';
import { acceptSuggestedWeek, getSuggestionContext, type SuggestedWeekDraft } from './week-suggestions';

const WEEK = '2026-09-21';
const TODAY = '2026-09-24';
const recipe = (name = 'Tomato pasta'): SuggestedDinner => ({ existingId: null, name, category: 'vegetarian',
  notes: 'Cook the pasta and simmer the tomatoes.', baseServings: 2,
  ingredients: [{ name: 'Pasta', quantity: 200, unit: 'g' }, { name: 'Tomato', quantity: 300, unit: 'g' }] });
const draft = (entries: { date: string; dinner: SuggestedDinner; servings?: number }[] = [{ date: TODAY, dinner: recipe() }]): SuggestedWeekDraft => ({
  weekStart: WEEK, contextKey: getSuggestionContext(WEEK, TODAY).key,
  entries: entries.map((entry) => ({ servings: 2, ...entry })) });

beforeEach(() => clearLocalData());

it('previews an empty household without creating data and saves only the accepted days with a usable list', () => {
  const preview = draft([{ date: TODAY, dinner: recipe() }, { date: '2026-09-26', dinner: recipe('Pasta bake') }]);
  expect(Object.values(store$.dinners.get())).toHaveLength(0);
  expect(Object.values(store$.shoppingLists.get())).toHaveLength(0);
  const listId = acceptSuggestedWeek({ ...preview, entries: preview.entries.slice(1) }, 'This week', TODAY);
  expect(listId).toBeTruthy();
  expect(Object.values(store$.dinners.get()).map((row) => row.name)).toEqual(['Pasta bake']);
  expect(Object.values(store$.planEntries.get()).map((row) => row.scheduled_date)).toEqual(['2026-09-26']);
  expect(Object.values(store$.shoppingListItems.get())).toEqual(expect.arrayContaining([
    expect.objectContaining({ shopping_list_id: listId, quantity: 200, unit: 'g', is_generated: true }),
    expect.objectContaining({ shopping_list_id: listId, quantity: 300, unit: 'g', is_generated: true }),
  ]));
  expect(acceptSuggestedWeek(preview, 'This week', TODAY)).toBeNull();
  expect(Object.values(store$.shoppingLists.get())).toHaveLength(1);
});

it('reuses saved recipes and scales shopping quantities to planned portions without rewriting recipe yield', () => {
  const id = createDinner({ name: 'Family pasta', default_servings: 4 });
  upsertDinnerItem(id, { ingredient_id: createIngredient({ name: 'Pasta' }), quantity: 400, unit: 'g' });
  const original = JSON.stringify(getDinner(id));
  const preview = draft([{ date: TODAY, dinner: getSuggestionContext(WEEK, TODAY).recipes[0] }]);
  const listId = acceptSuggestedWeek(preview, 'Week', TODAY);
  expect(Object.values(store$.planEntries.get())).toEqual([expect.objectContaining({ dinner_id: id, servings: 2 })]);
  expect(Object.values(store$.shoppingListItems.get())).toEqual([expect.objectContaining({ shopping_list_id: listId, quantity: 200 })]);
  expect(JSON.stringify(getDinner(id))).toBe(original);
  expect(Object.values(store$.dinners.get())).toHaveLength(1);
});

it('plans each day with its own servings and scales that day\'s shopping', () => {
  const listId = acceptSuggestedWeek(draft([
    { date: TODAY, dinner: recipe(), servings: 2 },
    { date: '2026-09-26', dinner: recipe('Pasta bake'), servings: 4 },
  ]), 'Week', TODAY);
  const entries = Object.values(store$.planEntries.get());
  expect(entries.find((row) => row.scheduled_date === TODAY)?.servings).toBe(2);
  expect(entries.find((row) => row.scheduled_date === '2026-09-26')?.servings).toBe(4);
  // Pasta: 200 g for 2 on Thursday + 400 g for 4 on Saturday.
  expect(Object.values(store$.shoppingListItems.get())).toEqual(expect.arrayContaining([
    expect.objectContaining({ shopping_list_id: listId, quantity: 600, unit: 'g' }),
  ]));
});

it('aggregates shared ingredients across generated meals', () => {
  acceptSuggestedWeek(draft([{ date: TODAY, dinner: recipe() }, { date: '2026-09-25', dinner: recipe('Pasta bake') }]), 'Week', TODAY);
  expect(Object.values(store$.ingredients.get())).toHaveLength(2);
  expect(Object.values(store$.shoppingListItems.get()).map((item) => item.quantity).sort()).toEqual([400, 600]);
});

it('rejects stale previews after an ingredient quantity changes without partially saving', () => {
  const id = createDinner({ name: 'Family pasta' });
  const ingredient = createIngredient({ name: 'Pasta' });
  upsertDinnerItem(id, { ingredient_id: ingredient, quantity: 200, unit: 'g' });
  const preview = draft();
  upsertDinnerItem(id, { ingredient_id: ingredient, quantity: 500, unit: 'g' });
  expect(acceptSuggestedWeek(preview, 'Week', TODAY)).toBeNull();
  expect(Object.values(store$.dinners.get())).toHaveLength(1);
  expect(store$.planEntries.get()).toEqual({});
  expect(store$.shoppingLists.get()).toEqual({});
});

it('rejects a preview after another device fills a day or the household changes', () => {
  const preview = draft();
  const id = createDinner({ name: 'Already planned' });
  const plan = createDinnerPlan({ name: 'Week', start_date: WEEK });
  createPlanEntry(plan, { dinner_id: id, scheduled_date: TODAY, servings: 2 });
  expect(acceptSuggestedWeek(preview, 'Week', TODAY)).toBeNull();
  const fresh = draft([{ date: '2026-09-25', dinner: recipe() }]);
  resetLocalDataForHousehold(12);
  expect(acceptSuggestedWeek(fresh, 'Week', TODAY)).toBeNull();
  expect(store$.dinners.get()).toEqual({});
});

it.each([
  (preview: SuggestedWeekDraft) => ({ ...preview, entries: preview.entries.map((entry) => ({ ...entry, servings: 0 })) }),
  (preview: SuggestedWeekDraft) => ({ ...preview, entries: [] }),
  (preview: SuggestedWeekDraft) => ({ ...preview, entries: [...preview.entries, ...preview.entries] }),
  (preview: SuggestedWeekDraft) => ({ ...preview, entries: [{ ...preview.entries[0], date: '2026-09-23' }] }),
  (preview: SuggestedWeekDraft) => ({ ...preview, entries: [{ date: TODAY, dinner: { ...recipe(), ingredients: [] }, servings: 2 }] }),
])('rejects invalid drafts before creating recipes or plans', (mutate) => {
  expect(acceptSuggestedWeek(mutate(draft()), 'Week', TODAY)).toBeNull();
  expect(store$.dinners.get()).toEqual({});
  expect(store$.dinnerPlans.get()).toEqual({});
  expect(store$.shoppingLists.get()).toEqual({});
});

it('reuses the linked list and preserves bought and manual rows when adding dinners', () => {
  const id = createDinner({ name: 'First meal' });
  const ingredient = createIngredient({ name: 'Pasta' });
  upsertDinnerItem(id, { ingredient_id: ingredient, quantity: 200, unit: 'g' });
  const plan = createDinnerPlan({ name: 'Week', start_date: WEEK });
  createPlanEntry(plan, { dinner_id: id, scheduled_date: TODAY, servings: 2 });
  const list = createShoppingListFromPlan(plan);
  const bought = Object.values(store$.shoppingListItems.get())[0].id;
  toggleShoppingItem(bought);
  const manual = addShoppingItem(list, { name: 'Coffee' });
  const before = [store$.shoppingListItems[bought].get(), store$.shoppingListItems[manual].get()];
  const preview = draft([{ date: '2026-09-25', dinner: recipe() }]);
  expect(acceptSuggestedWeek(preview, 'Week', TODAY)).toBe(list);
  expect(Object.values(store$.shoppingLists.get())).toHaveLength(1);
  expect([store$.shoppingListItems[bought].get(), store$.shoppingListItems[manual].get()]).toEqual(before);
  expect(Object.values(store$.shoppingListItems.get())).toContainEqual(expect.objectContaining({ ingredient_id: ingredient, quantity: 200, is_checked: false }));
});

it('clears personal preferences and rejected dinners when switching household', () => {
  store$.meta.planningPreferences.set({ text: 'No fish', shortcuts: ['quick'], excluded: ['Fish soup'], servings: 4 });
  resetLocalDataForHousehold(12);
  expect(store$.meta.planningPreferences.get()).toEqual({ text: '', shortcuts: [], excluded: [] });
});

it('filters saved recipes and invalidates previews when household exclusions change', () => {
  const id = createDinner({ name: 'Family pasta' });
  upsertDinnerItem(id, { ingredient_id: createIngredient({ name: 'Pasta' }), quantity: 200, unit: 'g' });
  const preview = draft();
  store$.households[store$.meta.localHouseholdId.get()].excluded_ingredients.set(['pasta']);

  expect(getSuggestionContext(WEEK, TODAY).recipes).toEqual([]);
  expect(acceptSuggestedWeek(preview, 'Week', TODAY)).toBeNull();
  expect(acceptSuggestedWeek(draft(), 'Week', TODAY)).toBeNull();
  expect(store$.planEntries.get()).toEqual({});
});

it('collects ingredients from all plans in the target week without leaking other weeks or households', () => {
  const planned = createDinner({ name: 'Planned pasta' });
  const nextWeek = createDinner({ name: 'Next week' });
  upsertDinnerItem(planned, { ingredient_id: createIngredient({ name: 'Tomato' }), quantity: 300, unit: 'g' });
  upsertDinnerItem(nextWeek, { ingredient_id: createIngredient({ name: 'Chicken' }), quantity: 400, unit: 'g' });
  const plan = createDinnerPlan({ name: 'Week', start_date: WEEK });
  createPlanEntry(plan, { dinner_id: planned, scheduled_date: TODAY, servings: 2 });
  createPlanEntry(plan, { dinner_id: nextWeek, scheduled_date: '2026-09-28', servings: 2 });
  const otherPlan = createDinnerPlan({ name: 'Other household', start_date: WEEK });
  store$.dinnerPlans[otherPlan].household_id.set('other-household');
  createPlanEntry(otherPlan, { dinner_id: nextWeek, scheduled_date: TODAY, servings: 2 });

  expect(getSuggestionContext(WEEK, TODAY).plannedIngredients).toEqual(['Tomato']);
});

it('clears ingredient exclusions when the local household is replaced', () => {
  store$.households[store$.meta.localHouseholdId.get()].excluded_ingredients.set(['Pasta']);
  resetLocalDataForHousehold(12);
  expect(getSuggestionContext(WEEK, TODAY).excludedIngredients).toEqual([]);
});
