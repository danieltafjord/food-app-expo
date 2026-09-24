import { aggregatePlanItems, updateShoppingListFromPlan } from '@/lib/shopping/generate';
import { createDinnerPlan, findPlanForWeek } from '@/lib/store/plans';
import { store$ } from '@/lib/store/collections';
import type {
  LocalDinner,
  LocalDinnerItem,
  LocalPlanEntry,
  LocalShoppingListItem,
} from '@/lib/store/schema';

const TS = '2026-01-01T00:00:00.000Z';

function dinner(over: Partial<LocalDinner> & { id: string }): LocalDinner {
  return {
    household_id: 'h1',
    name: 'Dinner',
    default_servings: 4,
    notes: null,
    category: null,
    created_at: TS,
    updated_at: TS,
    ...over,
  };
}

function item(
  over: Partial<LocalDinnerItem> & { id: string; dinner_id: string; ingredient_id: string },
): LocalDinnerItem {
  return { quantity: null, unit: null, created_at: TS, updated_at: TS, ...over };
}

function entry(
  over: Partial<LocalPlanEntry> & { id: string; dinner_plan_id: string; dinner_id: string },
): LocalPlanEntry {
  return {
    scheduled_date: '2026-06-01',
    servings: 4,
    meal_type: 'dinner',
    notes: null,
    created_at: TS,
    updated_at: TS,
    ...over,
  };
}

function seed(opts: {
  dinners?: LocalDinner[];
  items?: LocalDinnerItem[];
  entries?: LocalPlanEntry[];
}) {
  store$.dinners.set(Object.fromEntries((opts.dinners ?? []).map((d) => [d.id, d])));
  store$.dinnerItems.set(Object.fromEntries((opts.items ?? []).map((i) => [i.id, i])));
  store$.planEntries.set(Object.fromEntries((opts.entries ?? []).map((e) => [e.id, e])));
}

function reset() {
  store$.dinnerPlans.set({});
  store$.dinners.set({});
  store$.dinnerItems.set({});
  store$.planEntries.set({});
}

beforeEach(reset);
afterAll(reset);

describe('aggregatePlanItems', () => {
  it('includes meals from concurrently created plans for the same week', () => {
    const first = createDinnerPlan({ name: 'Week', start_date: '2026-06-01' });
    const second = createDinnerPlan({ name: 'Week', start_date: '2026-06-01' });
    const other = createDinnerPlan({ name: 'Next week', start_date: '2026-06-08' });
    seed({ dinners: [dinner({ id: 'd1' })],
      items: [item({ id: 'i1', dinner_id: 'd1', ingredient_id: 'rice', quantity: 100, unit: 'g' })],
      entries: [first, second, other].map((plan, i) => entry({ id: `e${i}`, dinner_plan_id: plan, dinner_id: 'd1' })),
    });
    expect(findPlanForWeek('2026-06-01')?.id).toBe([first, second].sort()[0]);
    expect(aggregatePlanItems(first)).toEqual([{ ingredient_id: 'rice', quantity: 200, unit: 'g' }]);
    expect(aggregatePlanItems(second)).toEqual(aggregatePlanItems(first));
  });

  it('counts concurrent copies of a recipe ingredient once using the latest quantity', () => {
    seed({ dinners: [dinner({ id: 'd1' })],
      items: [
        item({ id: 'old', dinner_id: 'd1', ingredient_id: 'rice', quantity: 100, unit: 'G' }),
        item({ id: 'new', dinner_id: 'd1', ingredient_id: 'rice', quantity: 200, unit: ' g ', updated_at: '2026-02-01T00:00:00Z' }),
      ], entries: [entry({ id: 'e1', dinner_plan_id: 'p1', dinner_id: 'd1' })],
    });
    expect(aggregatePlanItems('p1')).toEqual([{ ingredient_id: 'rice', quantity: 200, unit: 'g' }]);
  });

  it('scales quantities by servings / default_servings', () => {
    seed({
      dinners: [dinner({ id: 'd1', default_servings: 4 })],
      items: [item({ id: 'i1', dinner_id: 'd1', ingredient_id: 'ing1', quantity: 100, unit: 'g' })],
      entries: [entry({ id: 'e1', dinner_plan_id: 'p1', dinner_id: 'd1', servings: 8 })],
    });
    expect(aggregatePlanItems('p1')).toEqual([{ ingredient_id: 'ing1', unit: 'g', quantity: 200 }]);
  });

  it('sums the same ingredient + unit across entries', () => {
    seed({
      dinners: [dinner({ id: 'd1', default_servings: 2 })],
      items: [item({ id: 'i1', dinner_id: 'd1', ingredient_id: 'ing1', quantity: 50, unit: 'g' })],
      entries: [
        entry({ id: 'e1', dinner_plan_id: 'p1', dinner_id: 'd1', servings: 2 }), // 50
        entry({ id: 'e2', dinner_plan_id: 'p1', dinner_id: 'd1', servings: 4 }), // 100
      ],
    });
    expect(aggregatePlanItems('p1')).toEqual([{ ingredient_id: 'ing1', unit: 'g', quantity: 150 }]);
  });

  it('keeps the same ingredient in different units as separate lines', () => {
    seed({
      dinners: [dinner({ id: 'd1', default_servings: 4 })],
      items: [
        item({ id: 'i1', dinner_id: 'd1', ingredient_id: 'ing1', quantity: 1, unit: 'kg' }),
        item({ id: 'i2', dinner_id: 'd1', ingredient_id: 'ing1', quantity: 2, unit: 'g' }),
      ],
      entries: [entry({ id: 'e1', dinner_plan_id: 'p1', dinner_id: 'd1', servings: 4 })],
    });
    const result = aggregatePlanItems('p1');
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ ingredient_id: 'ing1', unit: 'kg', quantity: 1 });
    expect(result).toContainEqual({ ingredient_id: 'ing1', unit: 'g', quantity: 2 });
  });

  it('seeds a null quantity, then accumulates later non-nulls from 0', () => {
    seed({
      dinners: [dinner({ id: 'd1', default_servings: 4 }), dinner({ id: 'd2', default_servings: 4 })],
      items: [
        item({ id: 'i1', dinner_id: 'd1', ingredient_id: 'ing1', quantity: null, unit: 'pcs' }),
        item({ id: 'i2', dinner_id: 'd2', ingredient_id: 'ing1', quantity: 3, unit: 'pcs' }),
      ],
      entries: [
        entry({ id: 'e1', dinner_plan_id: 'p1', dinner_id: 'd1', servings: 4 }),
        entry({ id: 'e2', dinner_plan_id: 'p1', dinner_id: 'd2', servings: 4 }),
      ],
    });
    // d1 seeds the bucket null; d2 adds (null ?? 0) + 3 => 3
    expect(aggregatePlanItems('p1')).toEqual([{ ingredient_id: 'ing1', unit: 'pcs', quantity: 3 }]);
  });

  it('leaves quantity null when every contribution is null', () => {
    seed({
      dinners: [dinner({ id: 'd1', default_servings: 4 })],
      items: [item({ id: 'i1', dinner_id: 'd1', ingredient_id: 'ing1', quantity: null, unit: null })],
      entries: [entry({ id: 'e1', dinner_plan_id: 'p1', dinner_id: 'd1', servings: 8 })],
    });
    expect(aggregatePlanItems('p1')).toEqual([{ ingredient_id: 'ing1', unit: null, quantity: null }]);
  });

  it('rounds summed quantities to 2 decimals', () => {
    seed({
      dinners: [dinner({ id: 'd1', default_servings: 3 })],
      items: [item({ id: 'i1', dinner_id: 'd1', ingredient_id: 'ing1', quantity: 10, unit: 'g' })],
      entries: [entry({ id: 'e1', dinner_plan_id: 'p1', dinner_id: 'd1', servings: 4 })],
    });
    // 10 * (4/3) = 13.333… => 13.33
    expect(aggregatePlanItems('p1')).toEqual([{ ingredient_id: 'ing1', unit: 'g', quantity: 13.33 }]);
  });

  it('uses factor 1 when default_servings is 0', () => {
    seed({
      dinners: [dinner({ id: 'd1', default_servings: 0 })],
      items: [item({ id: 'i1', dinner_id: 'd1', ingredient_id: 'ing1', quantity: 7, unit: 'g' })],
      entries: [entry({ id: 'e1', dinner_plan_id: 'p1', dinner_id: 'd1', servings: 99 })],
    });
    expect(aggregatePlanItems('p1')).toEqual([{ ingredient_id: 'ing1', unit: 'g', quantity: 7 }]);
  });

  it('ignores entries whose dinner is missing', () => {
    seed({
      entries: [entry({ id: 'e1', dinner_plan_id: 'p1', dinner_id: 'ghost', servings: 4 })],
    });
    expect(aggregatePlanItems('p1')).toEqual([]);
  });

  it('only aggregates the requested plan', () => {
    seed({
      dinners: [dinner({ id: 'd1', default_servings: 4 })],
      items: [item({ id: 'i1', dinner_id: 'd1', ingredient_id: 'ing1', quantity: 100, unit: 'g' })],
      entries: [
        entry({ id: 'e1', dinner_plan_id: 'p1', dinner_id: 'd1', servings: 4 }),
        entry({ id: 'e2', dinner_plan_id: 'pOTHER', dinner_id: 'd1', servings: 4 }),
      ],
    });
    expect(aggregatePlanItems('p1')).toEqual([{ ingredient_id: 'ing1', unit: 'g', quantity: 100 }]);
  });
});

describe('updateShoppingListFromPlan', () => {
  const LIST_TS = '2026-01-02T00:00:00.000Z';

  function seedList(items: Partial<LocalShoppingListItem>[] = []) {
    store$.shoppingLists.set({
      l1: {
        id: 'l1',
        household_id: 'h1',
        dinner_plan_id: 'p1',
        name: 'Week',
        created_at: LIST_TS,
        updated_at: LIST_TS,
      },
    });
    store$.shoppingListItems.set(
      Object.fromEntries(
        items.map((it, i) => {
          const id = it.id ?? `s${i}`;
          return [
            id,
            {
              id,
              shopping_list_id: 'l1',
              ingredient_id: null,
              name: null,
              quantity: null,
              unit: null,
              is_checked: false,
              is_generated: true,
              created_at: LIST_TS,
              updated_at: LIST_TS,
              ...it,
            },
          ];
        }),
      ),
    );
  }

  function listItems() {
    return Object.values(store$.shoppingListItems.get()).filter((it) => it.shopping_list_id === 'l1');
  }

  beforeEach(() => {
    seed({
      dinners: [dinner({ id: 'd1', default_servings: 4 })],
      items: [
        item({ id: 'i1', dinner_id: 'd1', ingredient_id: 'beef', quantity: 400, unit: 'g' }),
        item({ id: 'i2', dinner_id: 'd1', ingredient_id: 'onion', quantity: 1, unit: 'stk' }),
      ],
      entries: [entry({ id: 'e1', dinner_plan_id: 'p1', dinner_id: 'd1', servings: 4 })],
    });
  });

  afterEach(() => {
    store$.shoppingLists.set({});
    store$.shoppingListItems.set({});
  });

  it('removes obsolete generated rows but preserves manual and bought items', () => {
    seedList([
      { id: 'generated', ingredient_id: 'beef', quantity: 400, unit: 'g' },
      { id: 'bought', ingredient_id: 'onion', quantity: 1, unit: 'stk', is_checked: true },
      { id: 'manual', ingredient_id: 'rice', quantity: 500, unit: 'g', is_generated: false },
    ]);
    store$.planEntries.set({});
    expect(updateShoppingListFromPlan('l1', 'p1')).toEqual({ added: 0, updated: 0, removed: 1 });
    expect(listItems().map((item) => item.id).sort()).toEqual(['bought', 'manual']);
  });

  it('counts manual quantities toward the requirement without rewriting them', () => {
    seedList([{ id: 'manual', ingredient_id: 'beef', quantity: 300, unit: 'g', is_generated: false }]);
    expect(updateShoppingListFromPlan('l1', 'p1')).toEqual({ added: 2, updated: 0, removed: 0 });
    expect(store$.shoppingListItems.manual.quantity.get()).toBe(300);
    expect(listItems()).toContainEqual(expect.objectContaining({ ingredient_id: 'beef', quantity: 100, is_generated: true }));
    expect(updateShoppingListFromPlan('l1', 'p1')).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it('adds rows the list is missing and reports the count', () => {
    seedList();
    expect(updateShoppingListFromPlan('l1', 'p1')).toEqual({ added: 2, updated: 0, removed: 0 });
    expect(listItems().map((it) => [it.ingredient_id, it.quantity, it.unit])).toEqual(
      expect.arrayContaining([
        ['beef', 400, 'g'],
        ['onion', 1, 'stk'],
      ]),
    );
  });

  it('updates an unchecked row to the plan quantity instead of duplicating it', () => {
    seedList([{ id: 's1', ingredient_id: 'beef', quantity: 200, unit: 'g' }]);
    expect(updateShoppingListFromPlan('l1', 'p1')).toEqual({ added: 1, updated: 1, removed: 0 });
    const beef = listItems().filter((it) => it.ingredient_id === 'beef');
    expect(beef).toHaveLength(1);
    expect(beef[0].quantity).toBe(400);
  });

  it('retains bought quantities and adds only the extra amount needed', () => {
    seedList([{ id: 's1', ingredient_id: 'beef', quantity: 200, unit: 'g', is_checked: true }]);
    expect(updateShoppingListFromPlan('l1', 'p1')).toEqual({ added: 2, updated: 0, removed: 0 });
    expect(store$.shoppingListItems.s1.quantity.get()).toBe(200);
    expect(store$.shoppingListItems.s1.is_checked.get()).toBe(true);
    expect(listItems()).toContainEqual(expect.objectContaining({ ingredient_id: 'beef', quantity: 200, is_checked: false }));
    expect(updateShoppingListFromPlan('l1', 'p1')).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it('matches units case-insensitively and keeps manual rows', () => {
    seedList([
      { id: 's1', ingredient_id: 'beef', quantity: 400, unit: 'G' },
      { id: 's2', name: 'Toalettpapir' },
    ]);
    expect(updateShoppingListFromPlan('l1', 'p1')).toEqual({ added: 1, updated: 0, removed: 0 });
    expect(listItems()).toHaveLength(3);
    expect(store$.shoppingListItems.s2.name.get()).toBe('Toalettpapir');
  });

  it('is a no-op when the list already matches', () => {
    seedList([
      { id: 's1', ingredient_id: 'beef', quantity: 400, unit: 'g' },
      { id: 's2', ingredient_id: 'onion', quantity: 1, unit: 'stk' },
    ]);
    expect(updateShoppingListFromPlan('l1', 'p1')).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(store$.shoppingLists.l1.updated_at.get()).toBe(LIST_TS);
  });
});
