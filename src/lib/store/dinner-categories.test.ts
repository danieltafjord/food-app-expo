import { store$ } from './collections';
import { deleteDinnerCategory, saveDinnerCategory } from './dinner-categories';
import { createDinner, getDinner, setDinnerItems } from './dinners';
import { createDinnerPlan, createPlanEntry } from './plans';
import { dinnerCategory, searchDinners } from '../dinner-categories';
import { indexByName } from '../search';

beforeEach(() => {
  store$.dinnerCategories.set({});
  store$.dinners.set({});
  store$.dinnerItems.set({});
  store$.dinnerPlans.set({});
  store$.planEntries.set({});
});

it('creates reusable categories offline and reuses names regardless of case and whitespace', () => {
  const id = saveDinnerCategory('  Quick   meals  ')!;
  expect(dinnerCategory(id)).toBe(id);
  expect(saveDinnerCategory('quick meals')).toBe(id);
  expect(Object.values(store$.dinnerCategories.get())).toHaveLength(1);
  expect(store$.dinnerCategories[id].name.get()).toBe('Quick meals');
});

it('rejects empty or oversized names and conflicting renames', () => {
  expect(saveDinnerCategory('   ')).toBeNull();
  expect(saveDinnerCategory('x'.repeat(81))).toBeNull();
  const first = saveDinnerCategory('Quick')!;
  const second = saveDinnerCategory('Weekend')!;
  expect(saveDinnerCategory('quick', second)).toBeNull();
  expect(store$.dinnerCategories[first].name.get()).toBe('Quick');
  expect(store$.dinnerCategories[second].name.get()).toBe('Weekend');
});

it('keeps assignments stable when a category is renamed and filters by its identity', () => {
  const category = saveDinnerCategory('Quick')!;
  const dinner = createDinner({ name: 'Soup', category });
  saveDinnerCategory('Weeknight', category);
  expect(getDinner(dinner)?.category).toBe(category);
  const results = searchDinners(indexByName([getDinner(dinner)!], (row) => row.name), '', category);
  expect(results.results.map((row) => row.id)).toEqual([dinner]);
});

it('deletes a category without deleting recipes, ingredients or scheduled meals', () => {
  const category = saveDinnerCategory('Quick')!;
  const dinner = createDinner({ name: 'Soup', category });
  setDinnerItems(dinner, [{ ingredient_id: 'rice', quantity: 100 }]);
  const plan = createDinnerPlan({ name: 'Week' });
  const entry = createPlanEntry(plan, { dinner_id: dinner, scheduled_date: '2026-09-28', servings: 2 });
  deleteDinnerCategory(category);
  expect(getDinner(dinner)).toMatchObject({ name: 'Soup', category: null });
  expect(getDinner(dinner)?.items).toHaveLength(1);
  expect(store$.planEntries[entry].get().dinner_id).toBe(dinner);
  expect(store$.dinnerCategories[category].get()).toBeUndefined();
  expect(saveDinnerCategory('Renamed after deletion', category)).toBeNull();
});
