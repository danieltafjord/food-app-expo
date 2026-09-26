import { batch, observable } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';

import { ApiError } from '@/lib/api/client';
import { translate, type TKey } from '@/lib/i18n';
import { hasExcludedIngredient } from '@/lib/ingredient-exclusions';
import { store$ } from '@/lib/store/collections';
import { dinnerItemsOf } from '@/lib/store/dinners';
import { getHouseholdDefaultServings } from '@/lib/store/household';
import { deletePlanEntry } from '@/lib/store/plans';
import { getLocale } from '@/lib/store/settings';
import { getWeekPlanningContext, suggestWeek } from '@/lib/store/week-planning';
import {
  getSuggestionContext,
  planSuggestedDinners,
  releaseSuggestedDinner,
  replacePlannedDinner,
} from '@/lib/store/week-suggestions';
import { noteRemoteChanges } from '@/lib/sync/remote-changes';
import { addWithUndo } from '@/lib/undo';
import { dateKeyOf, fromDateKey, isoWeekNumber, startOfWeek, toDateKey } from '@/lib/week';
import {
  mealNameKey,
  PREFERENCES_MAX,
  requestWeekSuggestions,
  type PlanningPreferences,
  type SuggestedDinner,
  type Weekday,
  type WeekSuggestionInput,
} from '@/lib/week-suggestions';

/**
 * Dinner suggestions land straight on the week board: the board is the preview,
 * and any day can be swapped again from its editor. A request runs in the
 * background (the sheet that asked has usually closed) while the days it will
 * fill show a placeholder, and a failure is kept for the board to show with a
 * retry.
 *
 * - `week`: fill the given open days of a week, each with its servings.
 * - `day`: add one more dinner to a day, whatever it already has. `servings`
 *   defaults to the household's; `wish` steers this one request only and is
 *   never remembered with the week's preferences.
 * - `swap`: replace a planned dinner, keeping its day and servings.
 */
export type SuggestionJob =
  | { kind: 'week'; weekStart: string; servings: Record<string, number> }
  | { kind: 'day'; date: string; servings?: number; wish?: string }
  | { kind: 'swap'; entryId: string };

type Failure = { id: number; message: TKey; job: SuggestionJob };

/** UI-only and in memory: what's on its way (date → dinners coming, entry → being swapped). */
const pending$ = observable({ days: {} as Record<string, number>, entries: {} as Record<string, true> });
const failure$ = observable<Failure | null>(null);

// One request at a time: the server lets each caller run a single generation,
// so a second one would only come back "busy".
let queue: Promise<void> = Promise.resolve();
let nextFailure = 1;

const EMPTY_PREFERENCES: PlanningPreferences = { text: '', shortcuts: [], excluded: [] };
const WEEKDAYS: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

class SuggestionError extends Error {
  constructor(readonly key: TKey) {
    super(key);
  }
}

/** Start a suggestion; the board shows it arriving. `random` is for tests. */
export function suggestDinners(job: SuggestionJob, random: () => number = Math.random): Promise<void> {
  failure$.set(null);
  markPending(job, 1);
  const scope = currentScope();
  queue = queue.then(async () => {
    try {
      await run(job, scope, random);
    } catch (cause) {
      if (currentScope() === scope) failure$.set({ id: nextFailure++, message: failureMessage(cause), job });
    } finally {
      markPending(job, -1);
    }
  });
  return queue;
}

/** How many suggested dinners are on their way to this day. */
export function useIncomingSuggestions(date: string): number {
  return useValue(() => pending$.days[date].get() ?? 0);
}

/** Days with suggestions on their way, so the planner doesn't offer them twice. */
export function useIncomingDays(): Record<string, number> {
  return useValue(pending$.days);
}

export function useSwapInProgress(entryId: string): boolean {
  return useValue(() => !!pending$.entries[entryId].get());
}

export function useSuggestionFailure(): Failure | null {
  return useValue(failure$);
}

export function dismissSuggestionFailure(): void {
  failure$.set(null);
}

export function retrySuggestion(): Promise<void> {
  const failure = failure$.peek();
  return failure ? suggestDinners(failure.job) : Promise.resolve();
}

/** Non-reactive read, for tests. */
export function currentSuggestionFailure(): Failure | null {
  return failure$.peek();
}

function markPending(job: SuggestionJob, delta: 1 | -1) {
  batch(() => {
    if (job.kind === 'swap') {
      if (delta > 0) pending$.entries[job.entryId].set(true);
      else pending$.entries[job.entryId].delete();
      return;
    }
    for (const date of job.kind === 'day' ? [job.date] : Object.keys(job.servings)) {
      const count = (pending$.days[date].peek() ?? 0) + delta;
      if (count > 0) pending$.days[date].set(count);
      else pending$.days[date].delete();
    }
  });
}

/** Results for another household or account are dropped, never written. */
function currentScope() {
  return `${store$.meta.localHouseholdId.peek()}/${store$.meta.accountId.peek()}/${store$.meta.serverHouseholdId.peek()}`;
}

function failureMessage(cause: unknown): TKey {
  if (cause instanceof SuggestionError) return cause.key;
  const code = cause instanceof ApiError ? (cause.body as { code?: string } | undefined)?.code : null;
  if (code === 'daily_limit') return 'weekPlanning.limited';
  if (cause instanceof ApiError && cause.status === 429) return 'weekPlanning.busy';
  return code === 'unavailable' ? 'weekPlanning.unavailable' : 'weekPlanning.failed';
}

/** The number of servings most of the days use; new recipes are written for it. */
export function usualServings(values: number[], fallback: number): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = fallback;
  for (const [value, count] of counts) if (count > (counts.get(best) ?? 0)) best = value;
  return best;
}

async function run(job: SuggestionJob, scope: string, random: () => number) {
  const today = toDateKey(new Date());
  const preferences = store$.meta.planningPreferences.peek() ?? EMPTY_PREFERENCES;
  const source = preferences.source ?? 'mix';

  // The days to fill, as they are now: a queued job may start after edits.
  let weekStart: string;
  let targets: { date: string; servings: number }[];
  let replacing: string | null = null;
  if (job.kind === 'swap') {
    const entry = store$.planEntries[job.entryId].peek();
    if (!entry) return;
    const date = dateKeyOf(entry.scheduled_date);
    weekStart = toDateKey(startOfWeek(fromDateKey(date)));
    targets = [{ date, servings: entry.servings }];
    replacing = store$.dinners[entry.dinner_id].peek()?.name ?? null;
  } else if (job.kind === 'day') {
    weekStart = toDateKey(startOfWeek(fromDateKey(job.date)));
    targets = [{ date: job.date, servings: job.servings ?? getHouseholdDefaultServings() }];
  } else {
    weekStart = job.weekStart;
    const open = getWeekPlanningContext(weekStart, today).dates;
    targets = Object.entries(job.servings).filter(([date]) => open.includes(date))
      .sort(([a], [b]) => a.localeCompare(b)).map(([date, servings]) => ({ date, servings }));
    if (!targets.length) return;
  }

  const context = getSuggestionContext(weekStart, today);
  const exclusions = context.excludedIngredients;
  const hidden = new Set([...preferences.excluded, ...(replacing ? [replacing] : [])].map(mealNameKey));
  const vegetarian = preferences.shortcuts.includes('vegetarian');
  let dinners: SuggestedDinner[];

  if (source === 'saved') {
    // The household's own dinners only: instant, offline, no quota. Dinners
    // without a recipe yet count too; they're still what the household eats.
    const ingredientRows = store$.ingredients.peek();
    const candidates = context.candidates.filter((candidate) => !hidden.has(mealNameKey(candidate.name))
      && (!vegetarian || candidate.category === 'vegetarian')
      && !hasExcludedIngredient(dinnerItemsOf(candidate.id)
        .map((item) => ingredientRows[item.ingredient_id]?.name ?? '').filter(Boolean), exclusions));
    const count = Math.min(targets.length, candidates.length);
    if (!count) throw new SuggestionError('weekPlanning.noSaved');
    const picked = suggestWeek({ ...context, dates: targets.slice(0, count).map((target) => target.date),
      candidates, missing: 0 }, null, random);
    dinners = (picked?.entries ?? []).map((entry) => ({ existingId: entry.dinnerId, name: entry.name,
      category: entry.category, notes: null, baseServings: entry.servings, ingredients: [] }));
  } else {
    const recipes = source === 'new' ? [] : context.recipes.filter((recipe) => !hidden.has(mealNameKey(recipe.name))
      && (!vegetarian || recipe.category === 'vegetarian')
      && recipe.name.length <= 120 && recipe.ingredients.length <= 20
      && recipe.ingredients.every((item) => item.name.length <= 120)).slice(0, 20);
    const offered = new Set(recipes.map((recipe) => mealNameKey(recipe.name)));
    // Half the week from the household's rotation; a single day is a coin toss.
    const reuse = Math.min(recipes.length, targets.length === 1 ? (random() < 0.5 ? 1 : 0) : Math.ceil(targets.length / 2));
    const input: WeekSuggestionInput = {
      count: targets.length,
      servings: usualServings(targets.map((target) => target.servings), getHouseholdDefaultServings()),
      locale: getLocale(),
      // A day's own wish comes first; the household's standing wishes still apply.
      preferences: [job.kind === 'day' ? job.wish?.trim() : '', preferences.text.trim()]
        .filter(Boolean).join('\n').slice(0, PREFERENCES_MAX),
      shortcuts: preferences.shortcuts,
      // Every other dinner the household has, so nothing new duplicates one;
      // offered recipes stay out, or picking one would read as a repeat.
      exclude: [...new Set([...(replacing ? [replacing] : []), ...preferences.excluded,
        ...context.allNames.filter((name) => !offered.has(mealNameKey(name)))])]
        .filter((name) => name.length <= 120).slice(0, 60),
      excluded_ingredients: exclusions,
      reuse_ingredients: context.plannedIngredients
        .filter((name) => name.length <= 120 && !hasExcludedIngredient([name], exclusions)).slice(0, 140),
      available: recipes.map((recipe) => ({ id: recipe.existingId!, name: recipe.name, category: recipe.category,
        ingredients: recipe.ingredients.map((item) => item.name) })),
      days: targets.map((target) => WEEKDAYS[fromDateKey(target.date).getDay()]),
      reuse,
    };
    dinners = await requestWeekSuggestions(input, recipes, new AbortController().signal);
  }

  if (currentScope() !== scope) return;
  write(job, weekStart, targets, dinners, today);
}

function write(job: SuggestionJob, weekStart: string, targets: { date: string; servings: number }[],
  dinners: SuggestedDinner[], today: string) {
  if (job.kind === 'swap') {
    if (replacePlannedDinner(job.entryId, dinners[0], today)) noteRemoteChanges([job.entryId]);
    return;
  }
  // A day filled meanwhile (another device, a drag) keeps what it has.
  const open = job.kind === 'week' ? new Set(getWeekPlanningContext(weekStart, today).dates) : null;
  const entries = targets.flatMap((target, index) => dinners[index] && (!open || open.has(target.date))
    ? [{ ...target, dinner: dinners[index] }] : []);
  const locale = getLocale();
  const ids = planSuggestedDinners(weekStart,
    translate(locale, 'plans.weekOf', { week: isoWeekNumber(fromDateKey(weekStart)) }), entries);
  noteRemoteChanges(ids);
  if (job.kind !== 'week' || !ids.length) return;
  const requested = Object.keys(job.servings).length;
  addWithUndo(ids.length < requested
    ? translate(locale, 'weekPlanning.addedSome', { count: ids.length, total: requested })
    : translate(locale, ids.length === 1 ? 'weekPlanning.addedOne' : 'weekPlanning.added', { count: ids.length }),
  () => {
    const removed = ids.flatMap((id) => {
      const entry = store$.planEntries[id].peek();
      return entry ? [entry] : [];
    });
    batch(() => {
      for (const entry of removed) deletePlanEntry(entry.id);
      for (const entry of removed) releaseSuggestedDinner(entry.dinner_id, dateKeyOf(entry.scheduled_date), today);
    });
  });
}
