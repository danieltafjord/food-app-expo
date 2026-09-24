import { aggregatePlanItems } from '@/lib/shopping/generate';
import { store$ } from './collections';
import { createDinner, getDinner, setDinnerItems } from './dinners';
import { createIngredient, deleteIngredient, getIngredient } from './ingredients';
import { addShoppingItem, buildShoppingSuggestions, createShoppingList, toggleShoppingItem } from './shopping-lists';

beforeEach(() => {
  store$.ingredients.set({});
  store$.dinners.set({});
  store$.dinnerItems.set({});
  store$.shoppingLists.set({});
  store$.shoppingListItems.set({});
  store$.dinnerPlans.set({});
  store$.planEntries.set({});
});

it('removes an ingredient from all dinners, lists, suggestions and future list generation', () => {
  const eggs = createIngredient({ name: 'Eggs' });
  const milk = createIngredient({ name: 'Milk' });
  const dinner = createDinner({ name: 'Pancakes' });
  const otherDinner = createDinner({ name: 'Omelette' });
  setDinnerItems(dinner, [{ ingredient_id: eggs }, { ingredient_id: milk }]);
  setDinnerItems(otherDinner, [{ ingredient_id: eggs, unit: 'g' }, { ingredient_id: eggs, unit: 'pcs' }]);
  store$.planEntries.entry.set({
    id: 'entry', dinner_plan_id: 'plan', dinner_id: dinner, scheduled_date: '2026-09-22',
    servings: 2, meal_type: 'dinner', notes: null, created_at: 'x', updated_at: 'x',
  });
  const list = createShoppingList('This week');
  const otherList = createShoppingList('Next week');
  addShoppingItem(list, { ingredient_id: eggs });
  toggleShoppingItem(addShoppingItem(otherList, { ingredient_id: eggs }));
  const kept = addShoppingItem(list, { ingredient_id: milk });

  deleteIngredient(eggs);

  expect(getIngredient(eggs)).toBeUndefined();
  expect(getDinner(dinner)!.items.map((item) => item.ingredient_id)).toEqual([milk]);
  expect(getDinner(otherDinner)!.items).toEqual([]);
  expect(Object.keys(store$.shoppingListItems.get())).toEqual([kept]);
  expect(Object.keys(store$.shoppingLists.get())).toHaveLength(2);
  expect(buildShoppingSuggestions().map((item) => item.name)).toEqual(['Milk']);
  expect(aggregatePlanItems('plan').map((item) => item.ingredient_id)).toEqual([milk]);
  expect(store$.planEntries.entry.get()).toBeDefined();
});

it('allows deliberate recreation without restoring old recipe or shopping rows', () => {
  const id = createIngredient({ name: 'Eggs' });
  const dinner = createDinner({ name: 'Omelette' });
  setDinnerItems(dinner, [{ ingredient_id: id }]);

  deleteIngredient(id);
  deleteIngredient(id);
  const replacement = createIngredient({ name: 'Eggs' });

  expect(replacement).not.toBe(id);
  expect(getIngredient(replacement)?.name).toBe('Eggs');
  expect(getDinner(dinner)!.items).toEqual([]);
});
