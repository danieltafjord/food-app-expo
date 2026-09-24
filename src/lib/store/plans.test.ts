import { store$ } from './collections';
import { createDinner, patchDinner } from './dinners';
import { createDinnerPlan, createPlanEntry, usePlanEntries, usePlanEntry } from './plans';

jest.mock('@legendapp/state/react', () => ({
  useValue: (read: (() => unknown) | { get: () => unknown }) => typeof read === 'function' ? read() : read.get(),
}));

it('refreshes cached plan rows after changing or clearing a dinner category', () => {
  store$.dinners.set({});
  store$.dinnerPlans.set({});
  store$.planEntries.set({});
  const dinner = createDinner({ name: 'Soup', category: 'meat' });
  const plan = createDinnerPlan({ name: 'Week', start_date: '2026-09-28' });
  const entry = createPlanEntry(plan, { dinner_id: dinner, scheduled_date: '2026-09-28', servings: 2 });

  const before = usePlanEntries(plan);
  expect(before[0].dinner_category).toBe('meat');
  patchDinner(dinner, { category: 'vegetarian' });
  const after = usePlanEntries(plan);
  expect(after).not.toBe(before);
  expect(after[0].dinner_category).toBe('vegetarian');
  expect(usePlanEntry(entry)?.dinner_category).toBe('vegetarian');
  patchDinner(dinner, { category: null });
  expect(usePlanEntries(plan)[0].dinner_category).toBeNull();
  expect(usePlanEntry(entry)?.dinner_category).toBeNull();
});
