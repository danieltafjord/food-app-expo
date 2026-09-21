import type { RequestOptions } from '@/lib/api/client';
import type { Household, User } from '@/lib/api/types';

export type AccountSetupPhase = 'setting-up' | 'error' | 'invitation' | 'ready';

/** Auth navigation must settle before deciding whether to create a household. */
export function deferHouseholdSetup(pathname: string): boolean {
  return pathname === '/sign-in' || pathname.startsWith('/oauth/') || pathname.startsWith('/invitations/');
}

type Request = <T>(path: string, options?: RequestOptions) => Promise<T>;

/** Fetch the account and safely provision its first household, without marking data synced. */
export async function setupAccount(
  request: Request,
  options: { defer: boolean; name: string; defaultServings: number; signal: AbortSignal },
): Promise<User> {
  const me = await request<User>('/me', { signal: options.signal });
  if (options.signal.aborted) throw new Error('Setup cancelled');
  if (me.current_household || options.defer) return me;

  const household = await request<Household>('/household/setup', {
    method: 'POST',
    body: { name: options.name, default_servings: options.defaultServings },
    signal: options.signal,
  });
  if (options.signal.aborted) throw new Error('Setup cancelled');
  return { ...me, current_household: household };
}
