import type { RequestOptions } from '@/lib/api/client';
import type { Household, User } from '@/lib/api/types';

/**
 * `offline`: the account couldn't be reached (no connection, a timeout). Not a
 * failure — setup retries by itself, with backoff and on return to the front.
 * `error` is kept for a server that answered and refused.
 */
export type AccountSetupPhase = 'setting-up' | 'offline' | 'error' | 'invitation' | 'ready';

/** Auth navigation must settle before deciding whether to create a household. */
export function deferHouseholdSetup(pathname: string): boolean {
  return pathname === '/sign-in' || pathname.startsWith('/oauth/') || pathname.startsWith('/invitations/');
}

type Request = <T>(path: string, options?: RequestOptions) => Promise<T>;

/** Fetch the account and safely provision its first household, without marking data synced. */
export async function setupAccount(
  request: Request,
  options: { defer: boolean; name: string; defaultServings: number; excludedIngredients?: string[]; signal: AbortSignal },
): Promise<User> {
  const me = await request<User>('/me', { signal: options.signal });
  if (options.signal.aborted) throw new Error('Setup cancelled');
  if (me.current_household || options.defer) return me;

  const household = await request<Household>('/household/setup', {
    method: 'POST',
    body: { name: options.name, default_servings: options.defaultServings,
      ...(options.excludedIngredients ? { excluded_ingredients: options.excludedIngredients } : {}) },
    signal: options.signal,
  });
  if (options.signal.aborted) throw new Error('Setup cancelled');
  return { ...me, current_household: household };
}
