import { observable } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';

import { nowIso } from '@/lib/store/ids';

export type SyncPhase = 'idle' | 'syncing' | 'error';

export type SyncStatus = {
  /** What the sync engine is doing right now. */
  phase: SyncPhase;
  /** ISO timestamp of the last successful sync, or null if never synced. */
  lastSyncedAt: string | null;
  /** Local changes not yet pushed to the backend. */
  pending: number;
  /** Last sync error message, if `phase === 'error'`. */
  error: string | null;
  /**
   * Rows the server refused in the last sync (invalid data, unknown parent).
   * They stay on this device but are no longer queued; surfaced once so the
   * user knows, cleared by the next clean sync.
   */
  rejected: number;
};

/**
 * Live sync state, surfaced by the `SyncIndicator`. Driven by the push/pull
 * loop via the setters below — see `@/lib/sync/engine`.
 */
export const syncStatus$ = observable<SyncStatus>({
  phase: 'idle',
  lastSyncedAt: null,
  pending: 0,
  error: null,
  rejected: 0,
});

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
  return { phase, lastSyncedAt, pending, error, rejected };
}

/* ---- Setters the Phase-2 sync engine calls -------------------------------- */

export function markSyncing(): void {
  syncStatus$.assign({ phase: 'syncing', error: null });
}

/**
 * @param moved whether the cycle actually exchanged rows; an empty poll keeps
 *   the previous `lastSyncedAt` so the status stays referentially quiet.
 */
export function markSynced(rejected = 0, moved = true): void {
  const patch: Partial<SyncStatus> = { phase: 'idle', pending: 0, error: null, rejected };
  if (moved || syncStatus$.lastSyncedAt.get() === null) patch.lastSyncedAt = nowIso();
  syncStatus$.assign(patch);
}

export function markSyncError(message: string): void {
  syncStatus$.assign({ phase: 'error', error: message });
}

/** Number of local changes queued to push (drives the "N pending" hint). */
export function setPendingCount(count: number): void {
  syncStatus$.pending.set(count);
}
