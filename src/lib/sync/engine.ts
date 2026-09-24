import { batch, type ListenerParams } from '@legendapp/state';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { ApiError, type RequestOptions } from '@/lib/api/client';
import { resetLocalDataForHousehold } from '@/lib/store/account';
import { archive } from '@/lib/store/archive';
import { restoreAllArchivedItems, settleArchive } from '@/lib/store/archiving';
import { bootStore } from '@/lib/store/boot';
import { store$ } from '@/lib/store/collections';
import { getLocalHouseholdId } from '@/lib/store/household';
import { nowIso } from '@/lib/store/ids';
import { whenHydrated } from '@/lib/store/persistence';
import { isTrackingSuspended } from '@/lib/store/tracking';

import { getSyncRequest, type SyncRequest } from './auth-bridge';
import { markSyncError, markSynced, markSyncing, setPendingCount, setRejectedCount } from './status';

/**
 * Cloud sync engine.
 *
 * The app stays local-first: every mutation lands in `store$` synchronously.
 * This engine watches the store, batches the changed rows, and exchanges them
 * with the Laravel `POST /api/v1/sync` endpoint — one debounced push/pull that
 * also pulls on app-foreground so the other device in the household sees the
 * newest data promptly.
 *
 * Contract (mirrors `App\Actions\Sync\ApplySyncBatch`):
 *  - rows carry a client UUID `id`; last-write-wins by client `updated_at`;
 *    deletes travel as bare tombstones `{ id, updated_at, deleted_at }`.
 *  - the request carries the integer `cursor` from the previous response and
 *    the `household_id` this device is bound to; the server refuses (409) if
 *    the account's active household differs, and the device re-binds.
 *  - the response returns rows above the cursor (tombstones included) plus any
 *    row this device pushed but lost on, `rejected` rows the server refused,
 *    and `remaps` for ingredients merged onto a same-named existing one.
 *
 * What to push is tracked explicitly in `store$.meta.dirty` / `.tombstones`
 * (not derived from timestamps) so the client clock and the server cursor
 * never mix. Tracking is always on, signed in or not, so edits made offline or
 * signed out reach the server once there is a session.
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
 * Every consecutive pull that brings back nothing doubles the idle cadence, up
 * to this ceiling. A device whose household has no other active member (the
 * common case: one person, one phone) otherwise pays a request — and a store
 * write for the cursor — every 30 s for nothing. Any local edit, a foreground
 * re-entry, a manual refresh, or a pull that finally carries changes resets the
 * cadence to `POLL_IDLE_MS`.
 */
const POLL_IDLE_MAX_MS = 5 * 60_000;
/**
 * Faster pull cadence while the app is foregrounded and recently active, so a
 * peer's edits surface within seconds during live planning. A websocket
 * "doorbell" (Reverb/Pusher → `syncNow()`) would slot in here later; this
 * adaptive poll is the no-infra version and the always-on fallback beneath it.
 */
const POLL_ACTIVE_MS = 8_000;
/** How long after the last local edit / foreground we keep the fast cadence. */
const ACTIVE_WINDOW_MS = 60_000;
/**
 * Hard ceiling on a single sync round-trip. React Native's `fetch` has no default
 * timeout, so a half-open socket would leave the `await` pending forever and,
 * because `inFlight` is only cleared in the `finally`, every later push/pull
 * would silently no-op. Aborting keeps the loop alive: the request fails, the
 * retry backoff kicks in, and sync recovers once connectivity returns.
 */
const REQUEST_TIMEOUT_MS = 20_000;
/**
 * Rows per request. Larger outboxes (a first upload of a long-used device) are
 * split into several round-trips so no single request can outgrow the timeout.
 * Chunks follow dependency order, so a child's parent is always in the same or
 * an earlier chunk. Must not exceed the server's batch cap (1000).
 */
const CHUNK_ROWS = 300;
/**
 * How long after sign-in / launch the first push-pull waits. The splash reveal
 * and the first screen's layout are still on the JS thread right then; folding
 * a pull response into the store at that moment is what a user feels as a
 * stutter on their first tap. A manual `syncNow()` cancels the wait.
 */
const INITIAL_SYNC_DELAY_MS = 1200;

/** The syncable collections, mapped to their server payload keys, in dependency order. */
export const SYNCABLE = [
  { collection: 'dinnerCategories', serverKey: 'dinner_categories', household: true, parentOf: [] },
  { collection: 'ingredients', serverKey: 'ingredients', household: true, parentOf: ['dinnerItems:ingredient_id', 'shoppingListItems:ingredient_id'] },
  { collection: 'dinners', serverKey: 'dinners', household: true, parentOf: ['dinnerItems:dinner_id', 'planEntries:dinner_id'] },
  { collection: 'dinnerItems', serverKey: 'dinner_items', household: false, parentOf: [] },
  { collection: 'dinnerPlans', serverKey: 'dinner_plans', household: true, parentOf: ['planEntries:dinner_plan_id'] },
  { collection: 'planEntries', serverKey: 'plan_entries', household: false, parentOf: [] },
  { collection: 'shoppingLists', serverKey: 'shopping_lists', household: true, parentOf: ['shoppingListItems:shopping_list_id'] },
  { collection: 'shoppingListItems', serverKey: 'shopping_list_items', household: false, parentOf: [] },
] as const;

type SyncConfig = (typeof SYNCABLE)[number];

const BY_COLLECTION = new Map<string, SyncConfig>(SYNCABLE.map((c) => [c.collection, c]));
const BY_SERVER_KEY = new Map<string, SyncConfig>(SYNCABLE.map((c) => [c.serverKey, c]));

type Row = Record<string, unknown> & { id: string };
type ServerRow = Row & { updated_at?: string | null; deleted_at?: string | null; erasure_version?: number };
type Rejection = { id: string | null; code: string; message: string };
export type SyncResponse = {
  cursor: number;
  household_id: number;
  changes: Record<string, ServerRow[]>;
  rejected?: Record<string, Rejection[]>;
  remaps?: Record<string, Record<string, string>>;
  /** More of a paged first sync to fetch; absent from servers that don't page. */
  next_page?: string | null;
};

/** What a single push sent, so we can clear exactly those entries on success. */
type PushSnapshot = {
  changes: Record<string, Row[]>;
  sentDirty: Record<string, Record<string, string>>; // collection → uuid → updated_at
  sentTombstones: Record<string, Record<string, string>>; // collection → uuid → deleted_at
  rows: number;
};

/** Thrown by callers that need the outbox empty first (e.g. switching household). */
export class SyncPendingError extends Error {
  constructor() {
    super('Local changes are still waiting to sync.');
    this.name = 'SyncPendingError';
  }
}

/* ---- module state -------------------------------------------------------- */

let tracking = false;
let started = false;
let connectionGeneration = 0;
let applyingRemote = false;
let inFlight: Promise<void> | null = null;
let rerun = false;
let foreground = true;
let lastActivityAt = 0; // epoch ms of the last local edit / foreground / manual sync
let retryAttempt = 0; // consecutive sync failures, for exponential backoff
let quietPulls = 0; // consecutive pulls that carried no changes, for idle backoff

let disposeListener: (() => void) | null = null;
let appStateSub: NativeEventSubscription | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let initialTimer: ReturnType<typeof setTimeout> | null = null;

// Dynamic collection access — the seven syncable maps are keyed by name.
const node = (collection: string): any => (store$ as any)[collection];

/* ---- lifecycle ----------------------------------------------------------- */

/**
 * Start recording local edits into the outbox. Idempotent; called by the
 * StoreProvider once the store has hydrated and booted, so persisted rows are
 * never marked dirty by their own restore. Runs whether or not anyone is signed
 * in — the outbox simply waits.
 */
export function ensureChangeTracking(): void {
  if (tracking) return;
  tracking = true;
  disposeListener = store$.onChange(handleStoreChange);
  updatePending();
}

/** Attach cloud sync to the local store (sign-in). Safe to call repeatedly. */
export async function connectCollections(): Promise<void> {
  if (started) return;
  started = true;
  const generation = ++connectionGeneration;

  await whenHydrated;
  if (!started || generation !== connectionGeneration) return; // disconnected while awaiting hydration

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
  ensureChangeTracking();

  appStateSub = AppState.addEventListener('change', handleAppStateChange);
  foreground = AppState.currentState === 'active';
  bumpActivity();
  schedulePoll();

  updatePending();
  initialTimer = setTimeout(() => {
    initialTimer = null;
    void pushPull();
  }, INITIAL_SYNC_DELAY_MS);
}

/**
 * Trigger a sync immediately (a "retry" tap on the status banner, or a
 * pull-to-refresh). Resolves once a full cycle that started after this call has
 * settled, so callers can drive a spinner; counts as activity so the fast poll
 * cadence stays warm afterwards.
 */
export async function syncNow(): Promise<void> {
  bumpActivity();
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (inFlight) {
    rerun = true;
    await inFlight.catch(() => undefined);
  }
  return pushPull();
}

/**
 * Push everything queued and report whether the outbox is now empty. Used before
 * operations that would strand local changes (switching household).
 */
export async function flushPendingChanges(): Promise<boolean> {
  if (!hasPending()) return true;
  await syncNow();
  return !hasPending();
}

/**
 * Call before an action that makes a different server household active
 * (create, join). `adoptServerHousehold` then wipes the local copy, and once
 * the server has switched it refuses pushes for the old household — so anything
 * still in the outbox has to go up first. A device not yet bound to a household
 * keeps its rows and uploads them into the new one, so there is nothing to flush.
 */
export async function ensureSyncedBeforeRebind(): Promise<void> {
  if (store$.meta.serverHouseholdId.get() == null) return;
  if (!(await flushPendingChanges())) {
    throw new SyncPendingError();
  }
}

/**
 * Bind this device to the given server household after the user switched,
 * created, or joined one. Binding to a different household than before wipes
 * the local copy (its rows stay on the server under the old household) and
 * pulls the new one fresh; binding for the first time keeps the local rows so
 * they upload.
 */
export async function adoptServerHousehold(householdId: number): Promise<void> {
  const bound = store$.meta.serverHouseholdId.get();
  if (bound !== null && bound !== householdId) {
    if (hasPending()) throw new SyncPendingError();
    connectionGeneration += 1;
    resetLocalDataForHousehold(householdId);
  } else {
    store$.meta.serverHouseholdId.set(householdId);
  }
  await syncNow();
}

/**
 * Detach cloud sync (sign-out). Local data, the cursor and the outbox stay
 * intact: edits made while signed out keep queueing, and signing back into the
 * same account resumes as a delta. Signing into a DIFFERENT account is handled
 * before we get here — the sign-in screen wipes and rebinds the local data (see
 * `resetLocalDataForAccount`), so it can't bleed across accounts.
 */
export function disconnectCollections(): void {
  if (!started) return;
  started = false;
  connectionGeneration += 1;

  appStateSub?.remove();
  appStateSub = null;
  if (pollTimer) clearTimeout(pollTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  if (initialTimer) clearTimeout(initialTimer);
  pollTimer = debounceTimer = retryTimer = initialTimer = null;
  retryAttempt = 0;
  rerun = false;
}

/** Test-only: forget all module state (listeners, timers, flags). */
export function __resetEngineForTests(): void {
  disconnectCollections();
  disposeListener?.();
  disposeListener = null;
  tracking = false;
  applyingRemote = false;
  inFlight = null;
  lastActivityAt = 0;
  quietPulls = 0;
}

/* ---- change tracking ----------------------------------------------------- */

function handleStoreChange(params: ListenerParams): void {
  // Archived items moving in and out of the store are not edits.
  if (applyingRemote || params.isFromPersist || isTrackingSuspended()) return;
  // Nothing local is on the server yet: the first sync uploads every row.
  if (!store$.meta.linked.peek()) return;

  let touched = false;
  // One notification for all the outbox writes of this change set, instead of
  // one per row (each would re-run every subscribed selector synchronously).
  batch(() => {
    for (const change of params.changes) {
      const collection = change.path[0];
      const uuid = change.path[1];
      if (!collection || collection === 'meta' || !uuid || !BY_COLLECTION.has(collection)) {
        continue;
      }

      store$.meta.failed[collection][uuid].delete();
      const isRowDelete = change.path.length === 2 && change.valueAtPath == null;
      if (isRowDelete) {
        store$.meta.tombstones[collection][uuid].set(nowIso());
        if (store$.meta.dirty[collection][uuid].get()) {
          store$.meta.dirty[collection][uuid].delete();
        }
      } else {
        store$.meta.dirty[collection][uuid].set(true);
        // A row re-created under a deleted id supersedes its tombstone.
        if (store$.meta.tombstones[collection][uuid].get()) {
          store$.meta.tombstones[collection][uuid].delete();
        }
      }
      touched = true;
    }
  });

  if (touched) {
    batch(() => {
      for (const [collection, rows] of Object.entries(store$.meta.failed.peek() ?? {})) {
        for (const [id, failure] of Object.entries(rows)) {
          if (failure.code === 'unknown_parent' && node(collection)[id].peek()) {
            store$.meta.failed[collection][id].delete();
            store$.meta.dirty[collection][id].set(true);
          }
        }
      }
    });
    bumpActivity();
    updatePending();
    if (started) {
      scheduleSync();
      schedulePoll(); // re-arm at the now-active cadence so peer edits pull fast
    }
  }
}

function scheduleSync(): void {
  if (!started || retryTimer) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void pushPull(), DEBOUNCE_MS);
}

function scheduleRetry(): void {
  if (!started) return;
  if (retryTimer) clearTimeout(retryTimer);
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryAttempt);
  const jitter = backoff * 0.25 * Math.random();
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void pushPull();
  }, backoff + jitter);
}

/* ---- adaptive poll ------------------------------------------------------- */

function bumpActivity(): void {
  lastActivityAt = Date.now();
  quietPulls = 0;
}

/**
 * Fast while foregrounded and recently active; slow once the session goes
 * quiet, and slower still the longer nothing arrives (see `POLL_IDLE_MAX_MS`).
 */
function pollDelay(): number {
  if (Date.now() - lastActivityAt < ACTIVE_WINDOW_MS) return POLL_ACTIVE_MS;
  return Math.min(POLL_IDLE_MAX_MS, POLL_IDLE_MS * 2 ** Math.min(quietPulls, 4));
}

/** Test/tooling hook: the delay the next poll would use. */
export function __pollDelayForTests(): number {
  return pollDelay();
}

/** (Re)arm the self-rescheduling pull timer. No-op while signed off or backgrounded. */
function schedulePoll(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (!started || !foreground) return;
  pollTimer = setTimeout(() => {
    if (!retryTimer) void pushPull();
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

function pushPull(): Promise<void> {
  if (inFlight) {
    rerun = true;
    return inFlight;
  }
  const request = getSyncRequest();
  if (!request || !started) return Promise.resolve(); // signed out
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  rerun = false;
  inFlight = runCycle(request, connectionGeneration).finally(() => {
    inFlight = null;
    updatePending();
    if (started && (rerun || hasSendable())) scheduleSync();
  });
  return inFlight;
}

async function runCycle(request: SyncRequest, generation: number): Promise<void> {
  const isCurrent = () => started && generation === connectionGeneration;
  // First connect surfaces errors (the user just linked an account and expects
  // sync to start); routine background pulls stay quiet.
  let hasPush = store$.meta.cursor.get() === null;

  try {
    const ready = await prepareFirstSync(request, isCurrent);
    if (!ready || !isCurrent()) return;

    hasPush = hasPush || hasSendable();
    if (hasPush) markSyncing();

    let received = 0;
    // Push in dependency-ordered chunks; the last request also carries the pull.
    for (const snapshot of collectPushChunks()) {
      refreshSnapshot(snapshot);
      // A first sync downloads the household page by page, so a long history
      // neither arrives as one huge response nor lands in the store at once.
      const firstSync = store$.meta.cursor.get() === null;
      let response = await timed<SyncResponse>(request, '/sync', {
        method: 'POST',
        body: {
          cursor: store$.meta.cursor.get(),
          household_id: store$.meta.serverHouseholdId.get(),
          changes: snapshot.changes,
          ...(firstSync ? { paged: true } : {}),
        },
      });
      if (!isCurrent()) return; // a previous session must never touch the current store

      received += applyResponse(snapshot, response).received;
      while (response.next_page) {
        response = await timed<SyncResponse>(request, '/sync', {
          method: 'POST',
          body: {
            cursor: null,
            household_id: store$.meta.serverHouseholdId.get(),
            changes: {},
            paged: true,
            page: response.next_page,
          },
        });
        if (!isCurrent()) return;
        received += applyResponse(emptySnapshot(), response).received;
      }
    }

    retryAttempt = 0; // connectivity restored — reset the backoff
    // Items of lists archived or restored (here or elsewhere) move once their
    // changes are on the server.
    try {
      settleArchive();
    } catch {
      // Retried after the next sync.
    }
    const moved = hasPush || received > 0;
    quietPulls = moved ? 0 : quietPulls + 1;
    markSynced(countFailed(), moved);
  } catch (error) {
    if (!isCurrent()) return;
    if (error instanceof ApiError && error.status === 409 && isHouseholdMismatch(error.body)) {
      if (hasPending()) {
        markSyncError('The active household changed. Switch back to the previous household to upload your pending changes.');
        scheduleRetry();
        return;
      }
      // The account's active household changed elsewhere: re-bind and start over.
      resetLocalDataForHousehold((error.body as { household_id: number }).household_id);
      rerun = true;
      return;
    }
    // Errors only matter when we have unsynced changes; a failed background
    // pull (e.g. offline with nothing pending) stays quiet.
    if (hasPush) {
      markSyncError(messageOf(error));
      scheduleRetry();
    }
  }
}

function isHouseholdMismatch(body: unknown): body is { code: string; household_id: number } {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { code?: unknown }).code === 'household_mismatch' &&
    typeof (body as { household_id?: unknown }).household_id === 'number'
  );
}

/**
 * On the very first sync, link this device to its server household.
 *
 * The app already has a create/join household UI, so we don't create one here —
 * we just wait until the user has an active household, then seed the outbox with
 * every existing local row so it uploads. Joining an existing household merges
 * both devices' data additively (distinct UUIDs), so nothing is lost. If the
 * device was bound to a different household before, the local copy is replaced.
 *
 * Returns false to skip this sync (signed in but no household yet).
 */
async function prepareFirstSync(request: SyncRequest, isCurrent: () => boolean): Promise<boolean> {
  if (store$.meta.cursor.get() !== null) return true; // already linked

  const me = await timed<{ current_household: { id: number } | null }>(request, '/me');
  if (!isCurrent()) return false;
  const active = me?.current_household?.id;
  if (!active) return false; // wait for the user to create/join one

  const bound = store$.meta.serverHouseholdId.get();
  if (bound !== null && bound !== active) {
    if (hasPending()) throw new SyncPendingError();
    resetLocalDataForHousehold(active);
  } else {
    store$.meta.serverHouseholdId.set(active);
  }
  // From here on every edit and delete is recorded; the seed covers the rest,
  // including items of archived lists, which only this device has.
  restoreAllArchivedItems();
  store$.meta.linked.set(true);
  seedOutboxFromLocal();
  return true;
}

/** Mark every existing local row dirty so the first sync uploads it. */
function seedOutboxFromLocal(): void {
  batch(() => {
    for (const { collection } of SYNCABLE) {
      for (const uuid of Object.keys(node(collection).get() ?? {})) {
        if (!store$.meta.tombstones[collection][uuid].get() && !store$.meta.failed[collection][uuid].get()) {
          store$.meta.dirty[collection][uuid].set(true);
        }
      }
    }
  });
}

/**
 * Split the outbox into request-sized snapshots in dependency order. Always
 * yields at least one (possibly empty) snapshot so a pull happens.
 */
function collectPushChunks(): PushSnapshot[] {
  const chunks: PushSnapshot[] = [];
  let current = emptySnapshot();

  const push = (serverKey: string, row: Row, mark: (s: PushSnapshot) => void) => {
    if (current.rows >= CHUNK_ROWS) {
      chunks.push(current);
      current = emptySnapshot();
    }
    (current.changes[serverKey] ??= []).push(row);
    mark(current);
    current.rows += 1;
  };

  const dirty = store$.meta.dirty.get() ?? {};
  const tombstones = store$.meta.tombstones.get() ?? {};

  for (const { collection, serverKey } of SYNCABLE) {
    for (const uuid of Object.keys(dirty[collection] ?? {})) {
      const row = node(collection)[uuid].get() as Row | undefined;
      if (!row) continue; // deleted since marked dirty — a tombstone covers it
      const updatedAt = String(row.updated_at ?? '');
      push(serverKey, { ...row }, (s) => ((s.sentDirty[collection] ??= {})[uuid] = updatedAt));
    }
    for (const [uuid, deletedAt] of Object.entries(tombstones[collection] ?? {})) {
      const at = String(deletedAt);
      push(serverKey, { id: uuid, updated_at: at, deleted_at: at }, (s) => ((s.sentTombstones[collection] ??= {})[uuid] = at));
    }
  }

  chunks.push(current);
  return chunks;
}

function emptySnapshot(): PushSnapshot {
  return { changes: {}, sentDirty: {}, sentTombstones: {}, rows: 0 };
}

/**
 * Fold one server response into the store. Order matters: the sent flags are
 * cleared FIRST so a row this device lost on (the server echoes its own newer
 * copy) is no longer "dirty" and gets applied — otherwise the loser would keep
 * its rejected edit forever while the cursor moved past the server's version.
 * Rows edited again mid-flight stay dirty and keep winning locally until pushed.
 */
function applyResponse(
  snapshot: PushSnapshot,
  response: SyncResponse,
): { rejected: number; received: number } {
  clearSent(snapshot);
  retainRejected(snapshot, response.rejected ?? {});
  applyRemaps(response.remaps ?? {});
  const received = applyRemote(response.changes ?? {});
  // Only write when something moved: every store write is a persist to disk,
  // and an idle poll that brings back nothing must not cost one. A paged first
  // sync keeps its cursor unset until the last page is in, so a sync cut off
  // halfway starts over rather than skipping the pages it never received.
  if (!response.next_page && store$.meta.cursor.get() !== response.cursor) {
    store$.meta.cursor.set(response.cursor);
  }
  if (store$.meta.serverHouseholdId.get() !== response.household_id) {
    store$.meta.serverHouseholdId.set(response.household_id);
  }

  const rejected = Object.values(response.rejected ?? {}).reduce((n, list) => n + list.length, 0);
  if (rejected > 0 && __DEV__) {
    console.warn('[sync] server rejected rows', response.rejected);
  }
  return { rejected, received };
}

function retainRejected(snapshot: PushSnapshot, rejected: Record<string, Rejection[]>): void {
  batch(() => {
    for (const [key, rows] of Object.entries(rejected)) {
      const collection = BY_SERVER_KEY.get(key)?.collection;
      if (!collection) continue;
      for (const rejection of rows) {
        const id = rejection.id;
        if (!id || store$.meta.dirty[collection][id].get() || store$.meta.tombstones[collection][id].get()) continue;
        const row = node(collection)[id].peek();
        if (row && snapshot.sentDirty[collection]?.[id] === String(row.updated_at ?? '')) {
          store$.meta.failed[collection][id].set({ code: rejection.code, message: rejection.message });
        }
      }
    }
  });
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

/**
 * The server merged one of our new ingredients onto an existing same-named one.
 * Re-point local references at the survivor (tracked, so they re-push with the
 * right id) and drop the duplicate row without tombstoning it — it never
 * existed on the server.
 */
function applyRemaps(remaps: Record<string, Record<string, string>>): void {
  const links: Record<string, readonly (readonly [string, string])[]> = {
    ingredients: [['dinnerItems', 'ingredient_id'], ['shoppingListItems', 'ingredient_id']],
    dinner_items: [],
  };
  for (const [serverKey, ids] of Object.entries(remaps)) {
    const collection = BY_SERVER_KEY.get(serverKey)?.collection;
    if (!collection || !links[serverKey]) continue;
    batch(() => {
      for (const [from, to] of Object.entries(ids)) {
        if (from === to) continue;
        for (const [child, fk] of links[serverKey]) {
          for (const row of Object.values(node(child).peek() ?? {}) as Row[]) {
            if (row[fk] === from) node(child)[row.id].assign({ [fk]: to, updated_at: nowIso() });
          }
        }
      }
    });
    applyingRemote = true;
    try {
      batch(() => {
        for (const [from, to] of Object.entries(ids)) {
          if (from === to) continue;
          const row = node(collection)[from].peek();
          // Preserve an edit made after the request snapshot under its canonical identity.
          if (collection === 'dinnerItems' && row && (store$.meta.dirty[collection][from].get() || store$.meta.failed[collection][from].get())) {
            node(collection)[to].set({ ...row, id: to });
            const failure = store$.meta.failed[collection][from].get();
            if (failure) store$.meta.failed[collection][to].set(failure);
            else store$.meta.dirty[collection][to].set(true);
          }
          if (store$.meta.tombstones[collection][from].get()) {
            store$.meta.tombstones[collection][to].set(store$.meta.tombstones[collection][from].get());
          }
          node(collection)[from].delete();
          store$.meta.dirty[collection][from].delete();
          store$.meta.failed[collection][from].delete();
          store$.meta.tombstones[collection][from].delete();
        }
      });
    } finally {
      applyingRemote = false;
    }
  }
}

/** Earlier chunks may remap parents, or remote cascades may remove later rows. */
function refreshSnapshot(snapshot: PushSnapshot): void {
  const fresh = emptySnapshot();
  for (const [collection, ids] of Object.entries(snapshot.sentDirty)) {
    const key = BY_COLLECTION.get(collection)!.serverKey;
    for (const id of Object.keys(ids)) {
      const row = node(collection)[id].peek() as Row | undefined;
      if (!row || !store$.meta.dirty[collection][id].get()) continue;
      (fresh.changes[key] ??= []).push({ ...row });
      (fresh.sentDirty[collection] ??= {})[id] = String(row.updated_at ?? '');
    }
  }
  for (const [collection, ids] of Object.entries(snapshot.sentTombstones)) {
    const key = BY_COLLECTION.get(collection)!.serverKey;
    for (const id of Object.keys(ids)) {
      const at = store$.meta.tombstones[collection][id].get();
      if (!at) continue;
      (fresh.changes[key] ??= []).push({ id, updated_at: at, deleted_at: at });
      (fresh.sentTombstones[collection] ??= {})[id] = at;
    }
  }
  Object.assign(snapshot, fresh);
}

/** Fold pulled rows into the store; returns how many rows the server sent. */
function applyRemote(changes: Record<string, ServerRow[]>): number {
  let received = 0;
  const deletedLists: string[] = [];
  const deletedItems: string[] = [];
  applyingRemote = true;
  try {
    batch(() => {
      for (const { collection, serverKey, household, parentOf } of SYNCABLE) {
        const deleted = new Set<string>();
        for (const row of changes[serverKey] ?? []) {
          if (typeof row?.id !== 'string') continue;
          received += 1;
          const uuid = row.id;
          const existing = node(collection)[uuid].peek() as ServerRow | undefined;
          // Account erasure overrides unsent and mid-flight edits. Otherwise the
          // cursor could advance while this device retains the erased content.
          const erased = (row.erasure_version ?? 0) > (existing?.erasure_version ?? 0);
          if (erased) clearOutbox(collection, uuid);
          // A row we've locally edited or deleted wins until it's pushed.
          if (inOutbox(collection, uuid)) continue;

          if (row.deleted_at != null) {
            if (collection === 'dinnerCategories') {
              for (const dinner of Object.values(store$.dinners.peek())) {
                if (dinner.category === uuid) store$.dinners[dinner.id].category.set(null);
              }
            }
            if (existing) node(collection)[uuid].delete();
            deleted.add(uuid);
            if (collection === 'shoppingLists') deletedLists.push(uuid);
            if (collection === 'shoppingListItems') deletedItems.push(uuid);
            continue;
          }

          // Match the local schema: drop the server-only `deleted_at` and
          // re-stamp the local household id on the household-scoped rows.
          const local: Record<string, unknown> = { ...row };
          // Older servers omit categories. Preserve local edits during rollout.
          if (collection === 'dinners' && !('category' in local)) local.category = existing?.category ?? null;
          if (collection === 'dinners') {
            for (const field of ['emoji', 'image_path', 'image_thumbhash'] as const) {
              if (!(field in local)) local[field] = existing?.[field] ?? null;
            }
          }
          if (collection === 'shoppingLists' && !('archived_at' in local)) local.archived_at = existing?.archived_at ?? null;
          delete local.deleted_at;
          if (household) local.household_id = getLocalHouseholdId();
          // The server echoes the rows this device just pushed. Writing an
          // identical copy back would still count as a change (a new object),
          // re-persisting the row and re-rendering everything showing it.
          if (existing && sameRow(existing, local)) continue;
          node(collection)[uuid].set(local);
        }
        // Mirror the local cascade so no orphaned children linger: one pass per
        // child table for all of this pull's deleted parents, before the child
        // rows themselves are applied.
        if (deleted.size === 0) continue;
        for (const link of parentOf) {
          const [child, fk] = link.split(':');
          for (const childRow of Object.values(node(child).peek() ?? {}) as Row[]) {
            if (typeof childRow[fk] === 'string' && deleted.has(childRow[fk])) {
              node(child)[childRow.id].delete();
              clearOutbox(child, childRow.id);
            }
          }
        }
      }
    });
  } finally {
    applyingRemote = false;
  }
  // Items kept for archived lists are not in the store: forget deleted ones.
  if (deletedLists.length > 0) archive().drop(deletedLists);
  if (deletedItems.length > 0) archive().forgetItems(deletedItems);
  return received;
}

type OutboxKind = 'failed' | 'dirty' | 'tombstones';
const OUTBOX: readonly OutboxKind[] = ['failed', 'dirty', 'tombstones'];

/**
 * Plain lookups: `store$.meta.dirty[collection][uuid].get()` would create an
 * observable node for every row a pull mentions, and Legend-State never frees
 * nodes for deleted keys.
 */
function queuedIn(kind: OutboxKind, collection: string, uuid: string): boolean {
  return (store$.meta[kind][collection].peek() as Record<string, unknown> | undefined)?.[uuid] != null;
}

function inOutbox(collection: string, uuid: string): boolean {
  return OUTBOX.some((kind) => queuedIn(kind, collection, uuid));
}

function clearOutbox(collection: string, uuid: string): void {
  for (const kind of OUTBOX) {
    if (queuedIn(kind, collection, uuid)) store$.meta[kind][collection][uuid].delete();
  }
}

/**
 * Whether a pulled row says nothing new. The server echoes every row a push
 * sent, but it formats timestamps with microseconds (`…:05.123000Z`) where the
 * device wrote milliseconds (`…:05.123Z`), and it always includes
 * `erasure_version`, which rows created on the device lack — so a plain
 * comparison never matched, and every edit was written, persisted and
 * re-rendered a second time when its own echo arrived.
 */
export function sameRow(local: Record<string, unknown>, remote: Record<string, unknown>): boolean {
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const a = local[key];
    const b = remote[key];
    if (a === b || (a == null && b == null)) continue;
    if (key === 'erasure_version' && (a ?? 0) === (b ?? 0)) continue;
    if (key.endsWith('_at') && typeof a === 'string' && typeof b === 'string' && sameInstant(a, b)) continue;
    return false;
  }
  return true;
}

const ISO_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})$/;

/** ISO-8601 instants equal to the millisecond, whatever their fraction digits. */
function sameInstant(a: string, b: string): boolean {
  const x = ISO_TIMESTAMP.exec(a);
  const y = ISO_TIMESTAMP.exec(b);
  if (!x || !y || x[3] !== y[3] || x[1] !== y[1]) return false;
  return (x[2] ?? '').padEnd(3, '0').slice(0, 3) === (y[2] ?? '').padEnd(3, '0').slice(0, 3);
}

/* ---- pending bookkeeping ------------------------------------------------- */

function countPending(
  dirty: Record<string, Record<string, unknown>>,
  tombstones: Record<string, Record<string, unknown>>,
): number {
  const count = (maps: Record<string, Record<string, unknown>>) =>
    Object.values(maps).reduce((sum, m) => sum + Object.keys(m ?? {}).length, 0);
  return count(dirty) + count(tombstones);
}

function hasSendable(): boolean {
  return countPending(store$.meta.dirty.get() ?? {}, store$.meta.tombstones.get() ?? {}) > 0;
}

function countFailed(): number {
  return Object.values(store$.meta.failed.get() ?? {}).reduce((sum, rows) => sum + Object.keys(rows ?? {}).length, 0);
}

export function hasPending(): boolean {
  return hasSendable() || countFailed() > 0;
}

export function getSyncFailures(): { collection: string; id: string; name: string; message: string }[] {
  return Object.entries(store$.meta.failed.get() ?? {}).flatMap(([collection, rows]) =>
    Object.entries(rows ?? {}).map(([id, failure]) => ({
      collection, id, name: failureName(collection, id), message: failure.message,
    })),
  );
}

function updatePending(): void {
  setPendingCount(countPending(store$.meta.dirty.get() ?? {}, store$.meta.tombstones.get() ?? {}) + countFailed());
  setRejectedCount(countFailed());
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Sync failed';
}

// Only used for the odd server-key lookup in tests/tooling; kept exported so the
// mapping has one source of truth.
export function collectionForServerKey(serverKey: string): string | undefined {
  return BY_SERVER_KEY.get(serverKey)?.collection;
}

function failureName(collection: string, id: string): string {
  const row = node(collection)[id].peek();
  return String(row?.name || store$.ingredients[row?.ingredient_id ?? ''].peek()?.name
    || store$.dinners[row?.dinner_id ?? ''].peek()?.name || collection);
}
