import type { RequestOptions } from '@/lib/api/client';

/**
 * Bridges the React-only `useSession().request` to the sync engine, which runs
 * outside React.
 *
 * `SessionProvider` pushes the authorized `request` here on sign-in and clears
 * it on sign-out; the engine reads it via `getSyncRequest()` for each push/pull.
 * The bridged `request` already handles token refresh and 401 → sign-out, so the
 * engine inherits all of that for free.
 */
export type SyncRequest = <T>(path: string, options?: RequestOptions) => Promise<T>;

let currentRequest: SyncRequest | null = null;

/** Called by `SessionProvider`: pass the authorized `request`, or null on sign-out. */
export function setSyncAuth(request: SyncRequest | null): void {
  currentRequest = request;
}

/** The authorized request fn, or null when signed out. */
export function getSyncRequest(): SyncRequest | null {
  return currentRequest;
}
