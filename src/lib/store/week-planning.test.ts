import { store$ } from './collections';
import { createDinner, deleteDinner, patchDinner } from './dinners';
import { ensureLocalHousehold } from './household';
import { createDinnerPlan, createPlanEntry } from './plans';
import { applyWeekDraft, getWeekPlanningContext, suggestWeek } from './week-planning';

const WEEK = '2026-09-28';
const TODAY = '2026-09-22';

beforeEach(() => {
  store$.dinners.set({});
  store$.dinnerItems.set({});
  store$.dinnerPlans.set({});
  store$.planEntries.set({});
  store$.households.set({});
  store$.meta.localHouseholdId.set('');
  store$.meta.accountId.set(null);
  ensureLocalHousehold();
});

function dinners(count: number) {
  return Array.from({ length: count }, (_, i) => createDinner({ name: `Dinner ${i}`, default_servings: i + 1 }));
}

function schedule(dinnerId: string, date: string, week = WEEK) {
  const planId = createDinnerPlan({ name: 'Existing plan', start_date: week });
  return createPlanEntry(planId, { dinner_id: dinnerId, scheduled_date: date, servings: 3 });
}

const context = (week = WEEK, today = TODAY) => getWeekPlanningContext(week, today);

it('requires seven different dinners for an empty full week, regardless of ingredients', () => {
  dinners(6);
  expect(context().missing).toBe(1);
  expect(suggestWeek(context())).toBeNull();
  createDinner({ name: 'One more' });
  const draft = suggestWeek(context())!;
  expect(draft.entries).toHaveLength(7);
  expect(new Set(draft.entries.map((entry) => entry.dinnerId)).size).toBe(7);
  expect(draft.entries.map((entry) => entry.date)).toEqual([
    '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  ]);
  expect(store$.dinnerPlans.get()).toEqual({});
  expect(store$.planEntries.get()).toEqual({});
});

it('only needs enough unused dinners for the remaining days and preserves existing plans', () => {
  const ids = dinners(7);
  const dates = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];
  const existing = ids.slice(0, 4).map((id, i) => schedule(id, dates[i]));
  const before = existing.map((id) => ({ ...store$.planEntries[id].get() }));
  expect(context().dates).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
  expect(context().missing).toBe(0);
  expect(context().candidates.map((dinner) => dinner.id).sort()).toEqual(ids.slice(4).sort());
  const draft = suggestWeek(context())!;
  expect(applyWeekDraft(draft, 'New plan', TODAY)).toBe(true);
  expect(existing.map((id) => store$.planEntries[id].get())).toEqual(before);
  expect(Object.values(store$.planEntries.get())).toHaveLength(7);
  for (const proposed of draft.entries) {
    expect(Object.values(store$.planEntries.get())).toContainEqual(expect.objectContaining({
      dinner_id: proposed.dinnerId, scheduled_date: proposed.date, servings: proposed.servings, meal_type: 'dinner',
    }));
  }
});

it('skips past dates but includes today, and offers nothing for a past or filled week', () => {
  dinners(7);
  expect(context('2026-09-21').dates).toHaveLength(6);
  expect(context('2026-09-21').dates[0]).toBe(TODAY);
  expect(suggestWeek(context('2026-09-14'))).toBeNull();
  const draft = suggestWeek(context())!;
  expect(applyWeekDraft(draft, 'Week', TODAY)).toBe(true);
  expect(suggestWeek(context())).toBeNull();
});

it('does not count blank names or duplicate dinner names as distinct choices', () => {
  createDinner({ name: 'Tacos' });
  createDinner({ name: ' tacos ' });
  createDinner({ name: '  ' });
  expect(context().candidates).toHaveLength(1);
  expect(context().missing).toBe(6);
});

it('excludes duplicate names of dinners already planned this week', () => {
  const tacos = createDinner({ name: 'Tacos' });
  createDinner({ name: 'TACOS' });
  schedule(tacos, WEEK);
  expect(context().candidates).toHaveLength(0);
});

it('scopes choices and occupied days to the active household', () => {
  const [id] = dinners(1);
  const foreign = createDinner({ name: 'Foreign dinner' });
  store$.dinners[foreign].household_id.set('another-household');
  const entryId = schedule(foreign, WEEK);
  store$.dinnerPlans[store$.planEntries[entryId].dinner_plan_id.get()].household_id.set('another-household');
  expect(context().candidates.map((dinner) => dinner.id)).toEqual([id]);
  expect(context().dates).toHaveLength(7);
});

it('prefers older and never-planned dinners without letting a future booking hide history', () => {
  const [recent, older, never] = dinners(3);
  schedule(recent, '2026-09-27', '2026-09-21');
  schedule(older, '2026-08-01', '2026-07-27');
  schedule(older, '2026-10-15', '2026-10-12');
  const weights = new Map(context().candidates.map((dinner) => [dinner.id, dinner.weight]));
  expect(weights.get(recent)).toBe(1);
  expect(weights.get(older)).toBe(58);
  expect(weights.get(never)).toBe(60);
});

it('makes shuffle visibly different even when randomness repeats, without writing anything', () => {
  dinners(7);
  const first = suggestWeek(context(), null, () => 0)!;
  const second = suggestWeek(context(), first, () => 0)!;
  expect(second.entries).not.toEqual(first.entries);
  expect(new Set(second.entries.map((entry) => entry.dinnerId)).size).toBe(7);
  expect(store$.dinnerPlans.get()).toEqual({});
  expect(store$.planEntries.get()).toEqual({});
});

it('can shuffle to an alternative dinner when only one day remains', () => {
  dinners(2);
  const sunday = context(WEEK, '2026-10-04');
  const first = suggestWeek(sunday, null, () => 0)!;
  const second = suggestWeek(sunday, first, () => 0)!;
  expect(second.entries).toHaveLength(1);
  expect(second.entries[0].dinnerId).not.toBe(first.entries[0].dinnerId);
});

it('rejects the entire preview if another device fills a day before acceptance', () => {
  const ids = dinners(8);
  const draft = suggestWeek(context())!;
  const entryId = schedule(ids[0], '2026-09-30');
  expect(applyWeekDraft(draft, 'Week', TODAY)).toBe(false);
  expect(Object.keys(store$.planEntries.get())).toEqual([entryId]);
});

it.each(['delete', 'rename', 'servings', 'account', 'household', 'midnight'] as const)(
  'rejects a stale preview after %s without partial writes', (change) => {
    dinners(7);
    const draft = suggestWeek(context())!;
    const id = draft.entries[0].dinnerId;
    if (change === 'delete') deleteDinner(id);
    if (change === 'rename') patchDinner(id, { name: 'Renamed dinner' });
    if (change === 'servings') patchDinner(id, { default_servings: 99 });
    if (change === 'account') store$.meta.accountId.set(42);
    if (change === 'household') store$.meta.localHouseholdId.set('another-household');
    expect(applyWeekDraft(draft, 'Week', change === 'midnight' ? '2026-09-29' : TODAY)).toBe(false);
    expect(store$.dinnerPlans.get()).toEqual({});
    expect(store$.planEntries.get()).toEqual({});
  },
);

it('saves once, including after a double tap', () => {
  dinners(7);
  const draft = suggestWeek(context())!;
  expect(applyWeekDraft(draft, 'Week', TODAY)).toBe(true);
  expect(applyWeekDraft(draft, 'Week', TODAY)).toBe(false);
  expect(Object.values(store$.dinnerPlans.get())).toHaveLength(1);
  expect(Object.values(store$.planEntries.get())).toHaveLength(7);
});

it('revalidates draft dates and dinner uniqueness before creating a plan', () => {
  dinners(7);
  const draft = suggestWeek(context())!;
  draft.entries[1] = { ...draft.entries[0], date: draft.entries[1].date };
  expect(applyWeekDraft(draft, 'Week', TODAY)).toBe(false);
  expect(store$.dinnerPlans.get()).toEqual({});
  expect(store$.planEntries.get()).toEqual({});
});
