import { ApiError } from '@/lib/api/client';
import { categorize, isCategoryId } from '@/lib/categorize';
import { store$ } from '@/lib/store/collections';
import { nowIso } from '@/lib/store/ids';
import type { LocalIngredient } from '@/lib/store/schema';
import type { SyncRequest } from '@/lib/sync/auth-bridge';
import type { Locale } from '@/lib/i18n/locale';

export function needsClassification(ingredient: LocalIngredient): boolean {
  return ingredient.category == null && ingredient.category_source !== 'user'
    && ingredient.name.length <= 120 && !categorize(ingredient.name);
}

/** Only applies to the unchanged snapshot in the same account and household. */
export async function classifyIngredient(
  ingredient: LocalIngredient,
  request: SyncRequest,
  locale: Locale,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<void> {
  const account = store$.meta.accountId.get();
  const household = store$.meta.localHouseholdId.get();
  const result = await request<{ category: unknown }>('/ai/categorize', {
    method: 'POST', body: { name: ingredient.name, locale }, signal,
  });
  if (signal.aborted || !isCurrent() || account !== store$.meta.accountId.get()
    || household !== store$.meta.localHouseholdId.get() || !isCategoryId(result.category)) return;
  const current = store$.ingredients[ingredient.id].get();
  if (!current || current.name !== ingredient.name || current.updated_at !== ingredient.updated_at
    || current.household_id !== ingredient.household_id || !needsClassification(current)) return;
  store$.ingredients[ingredient.id].assign({
    category: result.category, category_source: 'ai', updated_at: nowIso(),
  });
}

export function aiRetryDelay(error: unknown): number {
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
