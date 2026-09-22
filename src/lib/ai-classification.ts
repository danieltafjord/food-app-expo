import { ApiError } from '@/lib/api/client';
import { requestAi } from '@/lib/ai-request';
import { categorize, isCategoryId } from '@/lib/categorize';
import { store$ } from '@/lib/store/collections';
import { nowIso } from '@/lib/store/ids';
import type { LocalIngredient } from '@/lib/store/schema';
import type { SyncRequest } from '@/lib/sync/auth-bridge';
import type { Locale } from '@/lib/i18n/locale';

export function needsClassification(ingredient: LocalIngredient): boolean {
  return ingredient.category == null && ingredient.category_source !== 'user'
    && ingredient.name.trim().length > 0 && ingredient.name.length <= 120 && !categorize(ingredient.name);
}

export type ClassificationOutcome = 'applied' | 'uncertain' | 'stale';
export type ClassificationJob = { input: string; outcome: 'uncertain' | 'failed'; attempts: number; nextAttemptAt: number };

export function classificationInput(ingredient: LocalIngredient, locale: Locale): string {
  return JSON.stringify([store$.meta.accountId.get(), store$.meta.serverHouseholdId.get(),
    ingredient.name, Date.parse(ingredient.updated_at), locale]);
}

export function classificationReady(ingredient: LocalIngredient, locale: Locale): boolean {
  if (!needsClassification(ingredient)) return false;
  const job = store$.meta.aiClassificationJobs[ingredient.id].get();
  return !job || job.input !== classificationInput(ingredient, locale) || job.nextAttemptAt <= Date.now();
}

export async function runClassificationJob(
  ingredient: LocalIngredient, request: SyncRequest, locale: Locale,
  signal: AbortSignal, isCurrent: () => boolean,
): Promise<void> {
  const id = ingredient.id;
  const input = classificationInput(ingredient, locale);
  const previous = store$.meta.aiClassificationJobs[id].get();
  const attempts = previous?.input === input ? previous.attempts + 1 : 1;
  const stillCurrent = () => !signal.aborted && isCurrent()
    && !!store$.ingredients[id].get() && classificationInput(store$.ingredients[id].get(), locale) === input;
  try {
    const outcome = await classifyIngredient(ingredient, request, locale, signal, isCurrent);
    if (outcome === 'applied') store$.meta.aiClassificationJobs[id].delete();
    if (outcome === 'uncertain' && stillCurrent()) {
      store$.meta.aiClassificationJobs[id].set({ input, outcome, attempts, nextAttemptAt: Date.now() + 24 * 60 * 60_000 });
    }
  } catch (error) {
    if (stillCurrent()) {
      const delay = error instanceof ApiError && error.status === 429 ? aiRetryDelay(error)
        : Math.min(60 * 60_000, aiRetryDelay(error) * 2 ** Math.min(attempts - 1, 4));
      store$.meta.aiClassificationJobs[id].set({ input, outcome: 'failed', attempts, nextAttemptAt: Date.now() + delay });
    }
    throw error;
  }
}

/** Only applies to the unchanged snapshot in the same account and household. */
export async function classifyIngredient(
  ingredient: LocalIngredient,
  request: SyncRequest,
  locale: Locale,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<ClassificationOutcome> {
  // Legend-State get() returns a mutable object. Capture values before awaiting.
  ingredient = { ...ingredient };
  const account = store$.meta.accountId.get();
  const household = store$.meta.localHouseholdId.get();
  let result: { category: unknown };
  try {
    result = await requestAi<{ category: unknown }>(request, '/ai/categorize', {
      method: 'POST', body: { name: ingredient.name, locale }, signal,
    });
  } catch (error) {
    if (signal.aborted) return 'stale';
    throw error;
  }
  if (signal.aborted || !isCurrent() || account !== store$.meta.accountId.get()
    || household !== store$.meta.localHouseholdId.get()) return 'stale';
  const current = store$.ingredients[ingredient.id].get();
  if (!current || current.name !== ingredient.name || Date.parse(current.updated_at) !== Date.parse(ingredient.updated_at)
    || current.household_id !== ingredient.household_id || !needsClassification(current)) return 'stale';
  if (!isCategoryId(result.category) || result.category === 'other') return 'uncertain';
  store$.ingredients[ingredient.id].assign({
    category: result.category, category_source: 'ai', updated_at: nowIso(),
  });
  return 'applied';
}

export function aiRetryDelay(error: unknown): number {
  if (error instanceof ApiError && error.retryAfterMs != null) return Math.max(1000, error.retryAfterMs);
  if (error instanceof ApiError && error.status === 429) {
    const code = (error.body as { code?: string } | undefined)?.code;
    if (code === 'daily_limit') {
      const tomorrow = new Date();
      tomorrow.setUTCHours(24, 0, 0, 0);
      return Math.max(60_000, tomorrow.getTime() - Date.now());
    }
    return 60_000;
  }
  return 5 * 60_000;
}
