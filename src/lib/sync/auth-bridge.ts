import { observable } from '@legendapp/state';

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

/**
 * Observable view of the bridge: bumped each time an authorized `request` is
 * installed, 0 while there is none. Work that needs the session outside the
 * sync engine (registering the push token) waits on this rather than on
 * React state: `SessionProvider` installs the request in an effect, and its
 * descendants' effects run before it.
 */
export const syncAuthRevision$ = observable(0);
let revision = 0;

/** Called by `SessionProvider`: pass the authorized `request`, or null on sign-out. */
export function setSyncAuth(request: SyncRequest | null): void {
  if (request === currentRequest) return;
  currentRequest = request;
  if (request) revision += 1;
  syncAuthRevision$.set(request ? revision : 0);
}

/** The authorized request fn, or null when signed out. */
export function getSyncRequest(): SyncRequest | null {
  return currentRequest;
}
