import { batch, type ListenerParams } from '@legendapp/state';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { ApiError, type RequestOptions } from '@/lib/api/client';
import { bootStore } from '@/lib/store/boot';
import { store$ } from '@/lib/store/collections';
import { getLocalHouseholdId } from '@/lib/store/household';
import { nowIso } from '@/lib/store/ids';
import { whenHydrated } from '@/lib/store/persistence';

import { getSyncRequest, type SyncRequest } from './auth-bridge';
import { markSyncError, markSynced, markSyncing, setPendingCount } from './status';

/**
 * Cloud sync engine (Phase 2).
 *
 * The app stays local-first: every mutation lands in `store$` synchronously.
 * This engine watches the store, batches the changed rows, and exchanges them
 * with the Laravel `POST /api/v1/sync` endpoint — one debounced push/pull that
 * also pulls on app-foreground so the other device in the household sees the
 * newest data promptly.
 *
 * Identity, conflict handling, and tombstones mirror the backend: rows carry a
 * client UUID `id`, last-write-wins by `updated_at`, deletes travel as
 * tombstones. What to push is tracked explicitly in `store$.meta.dirty` /
 * `store$.meta.tombstones` (not derived from timestamps) so we never mix the
 * client clock with the server cursor.
 */

const DEBOUNCE_MS = 1500;
/** Retry backoff: first retry ~4s, doubling each consecutive failure, capped at
 *  5 min, with jitter so many devices don't retry in lockstep against a struggling
 *  server. Reset to 0 on any successful sync. */
const RETRY_BASE_MS = 4000;
const RETRY_MAX_MS = 5 * 60_000;
/** Background pull cadence when the user isn't actively planning. */
const POLL_IDLE_MS = 30_000;
/**
 * Faster pull cadence while the app is foregrounded and recently active, so a
 * peer's edits surface within a few seconds during live planning. The websocket
 * upgrade (Reverb/Pusher doorbell → `syncNow()`) would slot in here later; this
 * adaptive poll is the no-infra version and the always-on fallback beneath it.
 */
const POLL_ACTIVE_MS = 4_000;
/** How long after the last local edit / foreground we keep the fast cadence. */
const ACTIVE_WINDOW_MS = 60_000;
/**
 * Hard ceiling on a single sync round-trip. React Native's `fetch` has no default
 * timeout, so a half-open socket (captive portal, dropped connection) would leave
 * the `await` pending forever — and because `inFlight` is only cleared in the
 * `finally`, every subsequent push/pull would silently no-op. Aborting after this
 * keeps the loop alive: the request fails, the retry backoff kicks in, and sync
 * recovers once connectivity returns.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/** The seven syncable collections, mapped to their server payload keys. */
const SYNCABLE = [
  { collection: 'ingredients', serverKey: 'ingredients', household: true },
  { collection: 'dinners', serverKey: 'dinners', household: true },
  { collection: 'dinnerItems', serverKey: 'dinner_items', household: false },
  { collection: 'dinnerPlans', serverKey: 'dinner_plans', household: true },
  { collection: 'planEntries', serverKey: 'plan_entries', household: false },
  { collection: 'shoppingLists', serverKey: 'shopping_lists', household: true },
  { collection: 'shoppingListItems', serverKey: 'shopping_list_items', household: false },
] as const;

type SyncConfig = (typeof SYNCABLE)[number];

const BY_COLLECTION = new Map<string, SyncConfig>(SYNCABLE.map((c) => [c.collection, c]));

type Row = Record<string, unknown> & { id: string };
type ServerRow = Row & { updated_at?: string | null; deleted_at?: string | null };
type SyncResponse = { server_time: string; changes: Record<string, ServerRow[]> };

/** What a single push sent, so we can clear exactly those entries on success. */
type PushSnapshot = {
  changes: Record<string, Row[]>;
  sentDirty: Record<string, Record<string, string>>; // collection → uuid → updated_at
  sentTombstones: Record<string, Record<string, string>>; // collection → uuid → deleted_at
};

/* ---- module state -------------------------------------------------------- */

let started = false;
let applyingRemote = false;
let inFlight = false;
let rerun = false;
let foreground = true;
let lastActivityAt = 0; // epoch ms of the last local edit / foreground / manual sync
let retryAttempt = 0; // consecutive sync failures, for exponential backoff

let disposeListener: (() => void) | null = null;
let appStateSub: NativeEventSubscription | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

// Dynamic collection access — the seven syncable maps are keyed by name.
const node = (collection: string): any => (store$ as any)[collection];

/* ---- lifecycle ----------------------------------------------------------- */

/** Attach cloud sync to the local store. Safe to call repeatedly. */
export async function connectCollections(): Promise<void> {
  if (started) return;
  started = true;

  await whenHydrated;
  if (!started) return; // disconnected while awaiting hydration

  // Upgrade + seed the store before we read or push a single row. Idempotent and
  // shared with StoreProvider, so this either runs the migrations (if the engine
  // won the race) or is a no-op (if the UI already did). A boot failure means the
  // data is in an unknown shape — bail rather than sync garbage; StoreProvider
  // surfaces the error and a retry/relaunch re-runs it.
  try {
    bootStore();
  } catch {
    started = false;
    return;
  }

  // Attach AFTER hydration so restoring persisted rows doesn't mark them dirty.
  disposeListener = store$.onChange(handleStoreChange);
  appStateSub = AppState.addEventListener('change', handleAppStateChange);
  foreground = AppState.currentState === 'active';
  bumpActivity();
  schedulePoll();

  updatePending();
  void pushPull();
}

/**
 * Trigger a sync immediately (a "retry" tap on the status banner, or a
 * pull-to-refresh). Resolves once the cycle settles so callers can drive a
 * spinner; counts as activity so the fast poll cadence stays warm afterwards.
 */
export function syncNow(): Promise<void> {
  bumpActivity();
  return pushPull();
}

/** Detach cloud sync (sign-out). Local data and the outbox stay intact. */
export function disconnectCollections(): void {
  if (!started) return;
  started = false;

  disposeListener?.();
  disposeListener = null;
  appStateSub?.remove();
  appStateSub = null;
  if (pollTimer) clearTimeout(pollTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  pollTimer = debounceTimer = retryTimer = null;
  retryAttempt = 0;

  // Reset the sync cursor so signing back into the SAME account re-runs first-sync
  // (re-seed the outbox from local data, pull the household fresh) — without this a
  // stale cursor would never re-upload existing local rows. Signing into a
  // DIFFERENT account is handled before we get here: the sign-in screen wipes and
  // rebinds the local data (see `resetLocalDataForAccount`), so it can't bleed
  // across accounts. The outbox (dirty/tombstones) is left intact so edits made
  // while signed out still sync on reconnect.
  store$.meta.lastSync.set(null);
}

/* ---- change tracking ----------------------------------------------------- */

function handleStoreChange(params: ListenerParams): void {
  if (applyingRemote || params.isFromPersist) return;

  let touched = false;
  for (const change of params.changes) {
    const collection = change.path[0];
    const uuid = change.path[1];
    if (!collection || collection === 'meta' || !uuid || !BY_COLLECTION.has(collection)) {
      continue;
    }

    const isRowDelete = change.path.length === 2 && change.valueAtPath == null;
    if (isRowDelete) {
      store$.meta.tombstones[collection][uuid].set(nowIso());
      if (store$.meta.dirty[collection][uuid].get()) {
        store$.meta.dirty[collection][uuid].delete();
      }
    } else {
      store$.meta.dirty[collection][uuid].set(true);
    }
    touched = true;
  }

  if (touched) {
    bumpActivity();
    updatePending();
    scheduleSync();
    schedulePoll(); // re-arm at the now-active cadence so peer edits pull fast
  }
}

function scheduleSync(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void pushPull(), DEBOUNCE_MS);
}

function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryAttempt);
  const jitter = backoff * 0.25 * Math.random();
  retryAttempt += 1;
  retryTimer = setTimeout(() => void pushPull(), backoff + jitter);
}

/* ---- adaptive poll ------------------------------------------------------- */

function bumpActivity(): void {
  lastActivityAt = Date.now();
}

/** Fast while foregrounded and recently active; slow once the session goes quiet. */
function pollDelay(): number {
  return Date.now() - lastActivityAt < ACTIVE_WINDOW_MS ? POLL_ACTIVE_MS : POLL_IDLE_MS;
}

/** (Re)arm the self-rescheduling pull timer. No-op while signed off or backgrounded. */
function schedulePoll(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (!started || !foreground) return;
  pollTimer = setTimeout(() => {
    void pushPull();
    schedulePoll();
  }, pollDelay());
}

/** Pull on foreground re-entry and run the poll only while the app is visible. */
function handleAppStateChange(state: AppStateStatus): void {
  const active = state === 'active';
  if (active === foreground) return;
  foreground = active;
  if (active) {
    bumpActivity();
    void pushPull();
    schedulePoll();
  } else if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

/* ---- push / pull --------------------------------------------------------- */

/** Run a sync request with a timeout so a stalled connection can't pin `inFlight`. */
async function timed<T>(
  request: SyncRequest,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await request<T>(path, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function pushPull(): Promise<void> {
  if (inFlight) {
    rerun = true;
    return;
  }
  const request = getSyncRequest();
  if (!request) return; // signed out

  inFlight = true;
  rerun = false;

  // First connect surfaces errors (the user just linked an account and expects
  // sync to start); routine background pulls stay quiet.
  let hasPush = store$.meta.lastSync.get() === null;

  try {
    const ready = await prepareFirstSync(request);
    if (ready) {
      const snapshot = collectPush();
      hasPush = hasPush || countPending(snapshot.sentDirty, snapshot.sentTombstones) > 0;
      if (hasPush) markSyncing();

      const response = await timed<SyncResponse>(request, '/sync', {
        method: 'POST',
        body: { last_sync: store$.meta.lastSync.get(), changes: snapshot.changes },
      });

      applyRemote(response.changes);
      clearSent(snapshot);
      store$.meta.lastSync.set(response.server_time);
      retryAttempt = 0; // connectivity restored — reset the backoff
      markSynced();
    }
  } catch (error) {
    // Errors only matter when we have unsynced changes; a failed background
    // pull (e.g. offline with nothing pending) stays quiet.
    if (hasPush) {
      markSyncError(messageOf(error));
      scheduleRetry();
    }
  } finally {
    inFlight = false;
    updatePending();
    if (rerun || hasPending()) scheduleSync();
  }
}

/**
 * On the very first sync, link this device to its server household.
 *
 * The app already has a create/join household UI, so we don't create one here —
 * we just wait until the user has an active household, then seed the outbox with
 * every existing local row so it uploads. Joining an existing household merges
 * both devices' data additively (distinct UUIDs), so nothing is lost.
 *
 * Returns false to skip this sync (signed in but no household yet).
 */
async function prepareFirstSync(request: NonNullable<ReturnType<typeof getSyncRequest>>): Promise<boolean> {
  if (store$.meta.lastSync.get() !== null) return true; // already linked

  const me = await timed<{ current_household: { id: number } | null }>(request, '/me');
  if (!me?.current_household) return false; // wait for the user to create/join one

  seedOutboxFromLocal();
  return true;
}

/** Mark every existing local row dirty so the first sync uploads it. */
function seedOutboxFromLocal(): void {
  batch(() => {
    for (const { collection } of SYNCABLE) {
      for (const uuid of Object.keys(node(collection).get() ?? {})) {
        store$.meta.dirty[collection][uuid].set(true);
      }
    }
  });
}

function collectPush(): PushSnapshot {
  const changes: Record<string, Row[]> = {};
  const sentDirty: Record<string, Record<string, string>> = {};
  const sentTombstones: Record<string, Record<string, string>> = {};

  const dirty = store$.meta.dirty.get() ?? {};
  const tombstones = store$.meta.tombstones.get() ?? {};

  for (const { collection, serverKey } of SYNCABLE) {
    const rows: Row[] = [];

    for (const uuid of Object.keys(dirty[collection] ?? {})) {
      const row = node(collection)[uuid].get() as Row | undefined;
      if (!row) continue; // deleted since marked dirty — a tombstone covers it
      rows.push(row);
      (sentDirty[collection] ??= {})[uuid] = String(row.updated_at ?? '');
    }

    for (const [uuid, deletedAt] of Object.entries(tombstones[collection] ?? {})) {
      rows.push({ id: uuid, updated_at: deletedAt, deleted_at: deletedAt });
      (sentTombstones[collection] ??= {})[uuid] = deletedAt as string;
    }

    if (rows.length > 0) changes[serverKey] = rows;
  }

  return { changes, sentDirty, sentTombstones };
}

function applyRemote(changes: Record<string, ServerRow[]>): void {
  applyingRemote = true;
  try {
    batch(() => {
      for (const { collection, serverKey, household } of SYNCABLE) {
        for (const row of changes[serverKey] ?? []) {
          const uuid = row.id;
          // A row we've locally edited or deleted wins until it's pushed.
          if (store$.meta.dirty[collection][uuid].get()) continue;
          if (store$.meta.tombstones[collection][uuid].get()) continue;

          if (row.deleted_at != null) {
            if (node(collection)[uuid].get()) node(collection)[uuid].delete();
            continue;
          }

          // Match the local schema: drop the server-only `deleted_at` and
          // re-stamp the local household id on the household-scoped rows.
          const local: Record<string, unknown> = { ...row };
          delete local.deleted_at;
          if (household) local.household_id = getLocalHouseholdId();
          node(collection)[uuid].set(local);
        }
      }
    });
  } finally {
    applyingRemote = false;
  }
}

/** Clear exactly the entries we pushed, unless they were touched again mid-flight. */
function clearSent(snapshot: PushSnapshot): void {
  batch(() => {
    for (const [collection, uuids] of Object.entries(snapshot.sentDirty)) {
      for (const [uuid, sentUpdatedAt] of Object.entries(uuids)) {
        if (!store$.meta.dirty[collection][uuid].get()) continue;
        const row = node(collection)[uuid].get() as Row | undefined;
        if (!row || String(row.updated_at ?? '') === sentUpdatedAt) {
          store$.meta.dirty[collection][uuid].delete();
        }
      }
    }
    for (const [collection, uuids] of Object.entries(snapshot.sentTombstones)) {
      for (const [uuid, sentDeletedAt] of Object.entries(uuids)) {
        if (store$.meta.tombstones[collection][uuid].get() === sentDeletedAt) {
          store$.meta.tombstones[collection][uuid].delete();
        }
      }
    }
  });
}

/* ---- pending bookkeeping ------------------------------------------------- */

function countPending(
  dirty: Record<string, Record<string, unknown>>,
  tombstones: Record<string, Record<string, unknown>>,
): number {
  const count = (maps: Record<string, Record<string, unknown>>) =>
    Object.values(maps).reduce((sum, m) => sum + Object.keys(m).length, 0);
  return count(dirty) + count(tombstones);
}

function hasPending(): boolean {
  return countPending(store$.meta.dirty.get() ?? {}, store$.meta.tombstones.get() ?? {}) > 0;
}

function updatePending(): void {
  setPendingCount(countPending(store$.meta.dirty.get() ?? {}, store$.meta.tombstones.get() ?? {}));
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Sync failed';
}
