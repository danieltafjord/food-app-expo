import { aggregatePlanItems } from '@/lib/shopping/generate';
import { store$ } from '@/lib/store/collections';
import type { LocalDinner, LocalDinnerItem, LocalPlanEntry } from '@/lib/store/schema';

const TS = '2026-01-01T00:00:00.000Z';

function dinner(over: Partial<LocalDinner> & { id: string }): LocalDinner {
  return {
    household_id: 'h1',
    name: 'Dinner',
    default_servings: 4,
    notes: null,
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
  store$.dinners.set({});
  store$.dinnerItems.set({});
  store$.planEntries.set({});
}

beforeEach(reset);
afterAll(reset);

describe('aggregatePlanItems', () => {
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
