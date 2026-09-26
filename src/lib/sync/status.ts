import { observable } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';

/**
 * `offline`: the last push could not reach the server (no connection, a
 * timeout). A calm state, not a failure: the changes are safe on the device
 * and go up on a later retry.
 */
export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

/**
 * Why sync is in `error`, as a code the UI translates (never raw server or
 * network text):
 *  - `failed`: the server refused or failed the request; retried with backoff.
 *  - `householdChanged`: the account's active household changed elsewhere
 *    while this device still has changes for the previous one.
 *  - `householdGone`: as above, but this account is no longer a member of the
 *    previous household, so those changes can never upload.
 */
export type SyncErrorCode = 'failed' | 'householdChanged' | 'householdGone';

export type SyncStatus = {
  /** What the sync engine is doing right now. */
  phase: SyncPhase;
  /** ISO timestamp of the last successful sync, or null if never synced. */
  lastSyncedAt: string | null;
  /** Local changes not yet pushed to the backend. */
  pending: number;
  /** Why sync failed, if `phase === 'error'`. */
  error: SyncErrorCode | null;
  /**
   * Rows the server refused in the last sync (invalid data, unknown parent).
   * They stay on this device until corrected or deleted and block data resets.
   */
  rejected: number;
  /**
   * The cycle in flight is this device's first download of the household —
   * the only sync worth showing progress for; routine syncs stay silent.
   */
  firstSync: boolean;
};

const INITIAL: SyncStatus = {
  phase: 'idle',
  lastSyncedAt: null,
  pending: 0,
  error: null,
  rejected: 0,
  firstSync: false,
};

/**
 * Live sync state, surfaced by the `SyncIndicator`. Driven by the push/pull
 * loop via the setters below — see `@/lib/sync/engine`.
 */
export const syncStatus$ = observable<SyncStatus>({ ...INITIAL });

/**
 * Reactive read of the sync status. Reads the fields individually so that an
 * idle poll (which touches nothing) never re-renders the banner/indicator.
 */
export function useSyncStatus(): SyncStatus {
  const phase = useValue(syncStatus$.phase);
  const lastSyncedAt = useValue(syncStatus$.lastSyncedAt);
  const pending = useValue(syncStatus$.pending);
  const error = useValue(syncStatus$.error);
  const rejected = useValue(syncStatus$.rejected);
  const firstSync = useValue(syncStatus$.firstSync);
  return { phase, lastSyncedAt, pending, error, rejected, firstSync };
}

/* ---- Setters the Phase-2 sync engine calls -------------------------------- */

/** A previous account's successful sync must never appear on a new account. */
export function resetSyncStatus(): void {
  syncStatus$.set({ ...INITIAL });
}

export function markSyncing(firstSync = false): void {
  syncStatus$.assign({ phase: 'syncing', error: null, firstSync });
}

/**
 * @param moved whether the cycle actually exchanged rows; an empty poll keeps
 *   the previous `lastSyncedAt` so the status stays referentially quiet.
 */
export function markSynced(rejected = 0, moved = true): void {
  const patch: Partial<SyncStatus> = { phase: 'idle', pending: 0, error: null, rejected, firstSync: false };
  // Wall-clock time, not the server-corrected `nowIso`: it is only ever shown
  // relative to this device's own clock.
  if (moved || syncStatus$.lastSyncedAt.get() === null) patch.lastSyncedAt = new Date().toISOString();
  syncStatus$.assign(patch);
}

export function markSyncError(code: SyncErrorCode): void {
  syncStatus$.assign({ phase: 'error', error: code, firstSync: false });
}

/** Stop showing progress without claiming anything synced. */
export function markIdle(): void {
  syncStatus$.assign({ phase: 'idle', error: null, firstSync: false });
}

/** The push could not reach the server; the outbox waits for a retry. */
export function markOffline(): void {
  syncStatus$.assign({ phase: 'offline', error: null, firstSync: false });
}

/** Number of local changes queued to push (drives the "N pending" hint). */
export function setPendingCount(count: number): void {
  syncStatus$.pending.set(count);
}

export function setRejectedCount(count: number): void {
  syncStatus$.rejected.set(count);
}
