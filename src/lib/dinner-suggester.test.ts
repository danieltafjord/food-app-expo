/* eslint-disable import/first -- jest.mock must precede the imports it stubs */
jest.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
jest.mock('@/lib/haptics', () => ({ hapticWarning: () => {}, hapticSuccess: () => {} }));
jest.mock('@/lib/ai-request', () => ({ requestAi: jest.fn() }));

import { requestAi } from '@/lib/ai-request';
import { ApiError } from '@/lib/api/client';
import { clearLocalData } from '@/lib/store/account';
import { store$ } from '@/lib/store/collections';
import { createDinner, upsertDinnerItem } from '@/lib/store/dinners';
import { createIngredient } from '@/lib/store/ingredients';
import { createPlanEntry, ensurePlanForWeek } from '@/lib/store/plans';
import * as undo from '@/lib/undo';
import type { WeekSuggestionInput } from '@/lib/week-suggestions';
import { currentSuggestionFailure, dismissSuggestionFailure, retrySuggestion, suggestDinners } from './dinner-suggester';

const WEEK = '2026-09-21';
const TODAY = '2026-09-24';
const request = requestAi as jest.Mock;
const generated = (name: string) => ({ existing_id: null, name, category: 'meat', notes: 'Stek og server.',
  ingredients: [{ name: 'Kjøttdeig', quantity: 400, unit: 'g' }] });
const planned = () => Object.values(store$.planEntries.get())
  .map((entry) => [entry.scheduled_date, store$.dinners[entry.dinner_id].get()?.name, entry.servings]).sort();
const sent = (call = 0) => request.mock.calls[call][2].body as WeekSuggestionInput;
let toast: jest.SpyInstance;

function savedDinner(name: string, category: string | null = null) {
  const id = createDinner({ name, category });
  upsertDinnerItem(id, { ingredient_id: createIngredient({ name: `${name} base` }), quantity: 1, unit: 'stk' });
  return id;
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(`${TODAY}T12:00:00`), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  clearLocalData();
  store$.settings.locale.set('en');
  request.mockReset();
  dismissSuggestionFailure();
  toast = jest.spyOn(undo, 'addWithUndo');
});

afterEach(() => {
  undo.commitPendingDelete();
  toast.mockRestore();
  jest.useRealTimers();
});

it('mixes saved and new dinners for the chosen days and puts them straight on the plan', async () => {
  savedDinner('Family tacos');
  savedDinner('Fish soup');
  request.mockResolvedValue({ dinners: [generated('Kjøttkaker'), generated('Lasagne'), generated('Karbonader')] });

  await suggestDinners({ kind: 'week', weekStart: WEEK, servings: { [TODAY]: 4, '2026-09-25': 4, '2026-09-26': 6 } });

  expect(sent()).toMatchObject({ count: 3, servings: 4, reuse: 2, locale: 'en',
    days: ['thursday', 'friday', 'saturday'] });
  expect(sent().available.map((recipe) => recipe.name).sort()).toEqual(['Family tacos', 'Fish soup']);
  expect(planned()).toEqual([[TODAY, 'Kjøttkaker', 4], ['2026-09-25', 'Lasagne', 4], ['2026-09-26', 'Karbonader', 6]]);
  expect(toast).toHaveBeenCalledWith('3 dinners added', expect.any(Function));

  // Undo takes the week back, and the recipes nobody kept with it.
  undo.undoPendingDelete();
  expect(store$.planEntries.get()).toEqual({});
  expect(Object.values(store$.dinners.get()).map((row) => row.name).sort()).toEqual(['Family tacos', 'Fish soup']);
});

it('asks only for new recipes, and never for a vegetarian week with meat', async () => {
  savedDinner('Family tacos', 'meat');
  savedDinner('Bean chili', 'vegetarian');
  store$.meta.planningPreferences.set({ text: '', shortcuts: ['vegetarian'], excluded: [], source: 'mix' });
  request.mockResolvedValue({ dinners: [{ ...generated('Linsesuppe'), category: 'vegetarian' },
    { ...generated('Grønnsakslasagne'), category: 'vegetarian' }] });
  await suggestDinners({ kind: 'week', weekStart: WEEK, servings: { [TODAY]: 2, '2026-09-25': 2 } });
  expect(sent().available.map((recipe) => recipe.name)).toEqual(['Bean chili']);
  expect(sent().exclude).toContain('Family tacos');

  store$.meta.planningPreferences.source.set('new');
  request.mockResolvedValue({ dinners: [{ ...generated('Tomatsuppe'), category: 'vegetarian' }] });
  await suggestDinners({ kind: 'day', date: '2026-09-27' });
  expect(sent(1)).toMatchObject({ count: 1, reuse: 0, available: [], days: ['sunday'] });
  expect(sent(1).exclude).toEqual(expect.arrayContaining(['Family tacos', 'Bean chili', 'Linsesuppe']));
});

it('takes a day\'s own servings and wish for that request only', async () => {
  store$.meta.planningPreferences.set({ text: 'No fish', shortcuts: [], excluded: [], source: 'new' });
  request.mockResolvedValue({ dinners: [generated('Kyllingwok')] });

  await suggestDinners({ kind: 'day', date: TODAY, servings: 5, wish: '  Use up the chicken ' });

  expect(sent()).toMatchObject({ count: 1, servings: 5, preferences: 'Use up the chicken\nNo fish' });
  expect(planned()).toEqual([[TODAY, 'Kyllingwok', 5]]);
  expect(store$.meta.planningPreferences.text.get()).toBe('No fish');
});

it('fills from the household\'s own dinners without AI, as many days as it can', async () => {
  store$.meta.planningPreferences.set({ text: '', shortcuts: [], excluded: [], source: 'saved' });
  createDinner({ name: 'Pizza night' });

  await suggestDinners({ kind: 'week', weekStart: WEEK, servings: { [TODAY]: 3, '2026-09-25': 3 } });

  expect(request).not.toHaveBeenCalled();
  expect(planned()).toEqual([[TODAY, 'Pizza night', 3]]);
  expect(toast).toHaveBeenCalledWith('Filled 1 of 2 days', expect.any(Function));
});

it('keeps a day someone filled while the suggestions were on their way', async () => {
  let respond!: (value: unknown) => void;
  request.mockReturnValue(new Promise((resolve) => { respond = resolve; }));
  const done = suggestDinners({ kind: 'week', weekStart: WEEK, servings: { [TODAY]: 2, '2026-09-25': 2 } });
  await Promise.resolve();

  const plan = ensurePlanForWeek(WEEK, '2026-09-27', 'Week');
  createPlanEntry(plan, { dinner_id: createDinner({ name: 'Leftovers' }), scheduled_date: '2026-09-25', servings: 2 });
  respond({ dinners: [generated('Taco'), generated('Lasagne')] });
  await done;

  expect(planned()).toEqual([[TODAY, 'Taco', 2], ['2026-09-25', 'Leftovers', 2]]);
  expect(Object.values(store$.dinners.get())).not.toContainEqual(expect.objectContaining({ name: 'Lasagne' }));
});

it('swaps one day for a new idea and drops the suggestion it replaced', async () => {
  store$.meta.planningPreferences.set({ text: '', shortcuts: [], excluded: [], source: 'new' });
  request.mockResolvedValueOnce({ dinners: [generated('Taco')] });
  await suggestDinners({ kind: 'day', date: TODAY });
  const entryId = Object.keys(store$.planEntries.get())[0];

  request.mockResolvedValueOnce({ dinners: [generated('Fiskegrateng')] });
  await suggestDinners({ kind: 'swap', entryId });

  expect(sent(1).exclude).toContain('Taco');
  expect(planned()).toEqual([[TODAY, 'Fiskegrateng', 2]]);
  expect(Object.values(store$.dinners.get()).map((row) => row.name)).toEqual(['Fiskegrateng']);
});

it('keeps a failure for the board to retry, and says when the daily limit is reached', async () => {
  request.mockRejectedValueOnce(new ApiError(429, 'Limited', undefined, { code: 'daily_limit' }));
  await suggestDinners({ kind: 'day', date: TODAY });
  expect(currentSuggestionFailure()).toMatchObject({ message: 'weekPlanning.limited', job: { kind: 'day', date: TODAY } });
  expect(store$.planEntries.get()).toEqual({});

  request.mockResolvedValueOnce({ dinners: [generated('Taco')] });
  await retrySuggestion();
  expect(currentSuggestionFailure()).toBeNull();
  expect(planned()).toEqual([[TODAY, 'Taco', 2]]);
});

it('says when none of the household\'s own dinners fit', async () => {
  store$.meta.planningPreferences.set({ text: '', shortcuts: [], excluded: [], source: 'saved' });
  await suggestDinners({ kind: 'day', date: TODAY });
  expect(currentSuggestionFailure()?.message).toBe('weekPlanning.noSaved');
});

it('drops results that arrive after switching household', async () => {
  let respond!: (value: unknown) => void;
  request.mockReturnValue(new Promise((resolve) => { respond = resolve; }));
  const done = suggestDinners({ kind: 'day', date: TODAY });
  await Promise.resolve();
  store$.meta.localHouseholdId.set('another');
  respond({ dinners: [generated('Taco')] });
  await done;
  expect(store$.planEntries.get()).toEqual({});
  expect(store$.dinners.get()).toEqual({});
});
