import { store$ } from '@/lib/store/collections';
import {
  createDinner,
  deleteDinner,
  getDinner,
  rankByRecency,
  patchDinner,
  upsertDinnerItem,
  removeDinnerItem,
  setDinnerItems,
} from '@/lib/store/dinners';
import type { LocalPlanEntry } from '@/lib/store/schema';

beforeEach(() => {
  store$.dinners.set({});
  store$.dinnerItems.set({});
  store$.planEntries.set({});
  store$.households.set({});
  store$.meta.localHouseholdId.set('');
});

function itemsOf(dinnerId: string) {
  return getDinner(dinnerId)!.items;
}

describe('setDinnerItems', () => {
  it('creates rows for a new dinner', () => {
    const id = createDinner({ name: 'Tacos' });
    setDinnerItems(id, [
      { ingredient_id: 'beef', quantity: 400, unit: 'g' },
      { ingredient_id: 'tortilla', quantity: 8, unit: null },
    ]);
    const items = itemsOf(id);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.ingredient_id).sort()).toEqual(['beef', 'tortilla']);
  });

  it('keeps the row id when an ingredient is unchanged', () => {
    const id = createDinner({ name: 'Tacos' });
    setDinnerItems(id, [{ ingredient_id: 'beef', quantity: 400, unit: 'g' }]);
    const [before] = itemsOf(id);

    setDinnerItems(id, [{ ingredient_id: 'beef', quantity: 400, unit: 'g' }]);
    const [after] = itemsOf(id);

    expect(after.id).toBe(before.id);
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('updates quantity/unit in place and bumps updated_at', () => {
    const id = createDinner({ name: 'Tacos' });
    setDinnerItems(id, [{ ingredient_id: 'beef', quantity: 400, unit: 'g' }]);
    const [before] = itemsOf(id);
    store$.dinnerItems[before.id].updated_at.set('2000-01-01T00:00:00.000Z');

    setDinnerItems(id, [{ ingredient_id: 'beef', quantity: 500, unit: 'g' }]);
    const [after] = itemsOf(id);

    expect(after.id).toBe(before.id);
    expect(after.quantity).toBe(500);
    expect(after.updated_at > '2000-01-01T00:00:00.000Z').toBe(true);
  });

  it('deletes rows whose ingredient is gone and adds new ones', () => {
    const id = createDinner({ name: 'Tacos' });
    setDinnerItems(id, [
      { ingredient_id: 'beef', quantity: 400, unit: 'g' },
      { ingredient_id: 'tortilla', quantity: 8, unit: null },
    ]);
    const beefId = itemsOf(id).find((i) => i.ingredient_id === 'beef')!.id;

    setDinnerItems(id, [
      { ingredient_id: 'beef', quantity: 400, unit: 'g' },
      { ingredient_id: 'salsa', quantity: 1, unit: 'jar' },
    ]);
    const items = itemsOf(id);

    expect(items.map((i) => i.ingredient_id).sort()).toEqual(['beef', 'salsa']);
    expect(items.find((i) => i.ingredient_id === 'beef')!.id).toBe(beefId);
  });

  it('does not touch another dinner’s items', () => {
    const a = createDinner({ name: 'A' });
    const b = createDinner({ name: 'B' });
    setDinnerItems(a, [{ ingredient_id: 'beef', quantity: 1, unit: null }]);
    setDinnerItems(b, [{ ingredient_id: 'beef', quantity: 2, unit: null }]);

    setDinnerItems(a, []);

    expect(itemsOf(a)).toHaveLength(0);
    expect(itemsOf(b)).toHaveLength(1);
  });
});

describe('deleteDinner', () => {
  it('cascades to items and plan entries', () => {
    const id = createDinner({ name: 'Tacos' });
    setDinnerItems(id, [{ ingredient_id: 'beef', quantity: 1, unit: null }]);
    store$.planEntries.set({
      e1: {
        id: 'e1',
        dinner_plan_id: 'p1',
        dinner_id: id,
        scheduled_date: '2026-06-01',
        servings: 2,
        meal_type: 'dinner',
        notes: null,
        created_at: 'x',
        updated_at: 'x',
      },
    });

    deleteDinner(id);

    expect(store$.dinners.get()[id]).toBeUndefined();
    expect(Object.keys(store$.dinnerItems.get())).toHaveLength(0);
    expect(Object.keys(store$.planEntries.get())).toHaveLength(0);
  });
});

describe('rankByRecency', () => {
  function entry(dinner_id: string, scheduled_date: string): LocalPlanEntry {
    return {
      id: `${dinner_id}-${scheduled_date}`,
      dinner_plan_id: 'plan',
      dinner_id,
      scheduled_date,
      servings: 4,
      meal_type: 'dinner',
      notes: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
  }

  it('puts the most recently planned dinner first and never-planned ones last, alphabetical', () => {
    const tacos = getDinner(createDinner({ name: 'Tacos' }))!;
    const pizza = getDinner(createDinner({ name: 'Pizza' }))!;
    const lasagne = getDinner(createDinner({ name: 'Lasagne' }))!;
    const fish = getDinner(createDinner({ name: 'Fiskesuppe' }))!;
    const ranked = rankByRecency(
      [tacos, pizza, lasagne, fish],
      [entry(tacos.id, '2026-08-01'), entry(tacos.id, '2026-09-10'), entry(pizza.id, '2026-09-04')],
    );
    expect(ranked.map((d) => d.name)).toEqual(['Tacos', 'Pizza', 'Fiskesuppe', 'Lasagne']);
    expect(ranked[0].last_planned).toBe('2026-09-10');
    expect(ranked[2].last_planned).toBeNull();
  });

  it('reads a full ISO timestamp as its local calendar day', () => {
    const tacos = getDinner(createDinner({ name: 'Tacos' }))!;
    const [ranked] = rankByRecency([tacos], [entry(tacos.id, '2026-09-10T18:00:00.000Z')]);
    expect(ranked.last_planned).toMatch(/^2026-09-1[01]$/);
  });
});


it('edits recipe fields without overwriting remote ingredient changes', () => {
  const id = createDinner({ name: 'Tacos', default_servings: 4 });
  upsertDinnerItem(id, { ingredient_id: 'beef', quantity: 100, unit: 'g' });
  const row = itemsOf(id)[0];
  store$.dinnerItems[row.id].quantity.set(200);
  upsertDinnerItem(id, { ingredient_id: 'onion', quantity: 2 });
  patchDinner(id, { notes: 'Cook slowly' });
  expect(itemsOf(id)).toHaveLength(2);
  expect(store$.dinnerItems[row.id].quantity.get()).toBe(200);
  expect(getDinner(id)).toMatchObject({ name: 'Tacos', default_servings: 4, notes: 'Cook slowly' });
});

it('edits and removes one unit row without changing the other', () => {
  const id = createDinner({ name: 'Rice' });
  upsertDinnerItem(id, { ingredient_id: 'rice', quantity: 100, unit: 'g' });
  upsertDinnerItem(id, { ingredient_id: 'rice', quantity: 1, unit: 'cup' });
  const row = itemsOf(id).find((item) => item.unit === 'g')!;
  upsertDinnerItem(id, { ingredient_id: 'rice', quantity: 200, unit: 'g' }, row.id);
  expect(itemsOf(id)).toHaveLength(2);
  removeDinnerItem(id, row.id);
  expect(itemsOf(id)).toEqual([expect.objectContaining({ quantity: 1, unit: 'cup' })]);
  upsertDinnerItem(id, { ingredient_id: 'rice', quantity: 300, unit: 'g' }, row.id);
  expect(itemsOf(id)).toHaveLength(1);
});


it('preserves distinct unit rows when replacing the full recipe ingredient set', () => {
  const id = createDinner({ name: 'Rice' });
  setDinnerItems(id, [
    { ingredient_id: 'rice', quantity: 100, unit: 'g' },
    { ingredient_id: 'rice', quantity: 1, unit: 'cup' },
  ]);
  const ids = itemsOf(id).map((item) => item.id).sort();
  setDinnerItems(id, [
    { ingredient_id: 'rice', quantity: 200, unit: 'g' },
    { ingredient_id: 'rice', quantity: 1, unit: 'cup' },
  ]);
  expect(itemsOf(id).map((item) => item.id).sort()).toEqual(ids);
  expect(itemsOf(id)).toHaveLength(2);
});

it('stores, preserves and clears categories without changing recipe ingredients', () => {
  const id = createDinner({ name: 'Soup' });
  expect(getDinner(id)?.category).toBeNull();
  setDinnerItems(id, [{ ingredient_id: 'beans', quantity: 200, unit: 'g' }]);
  const items = itemsOf(id);
  patchDinner(id, { category: 'vegetarian' });
  patchDinner(id, { notes: 'Serve hot' });
  expect(getDinner(id)).toMatchObject({ category: 'vegetarian', notes: 'Serve hot', items });
  patchDinner(id, { category: null });
  expect(getDinner(id)).toMatchObject({ category: null, items });
});
