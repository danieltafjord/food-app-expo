import { batch, type ListenerParams } from '@legendapp/state';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { ApiError, type RequestOptions } from '@/lib/api/client';
import { resetLocalDataForHousehold } from '@/lib/store/account';
import { bootStore } from '@/lib/store/boot';
import { store$ } from '@/lib/store/collections';
import { getLocalHouseholdId } from '@/lib/store/household';
import { nowIso } from '@/lib/store/ids';
import { whenHydrated } from '@/lib/store/persistence';

import { getSyncRequest, type SyncRequest } from './auth-bridge';
import { markSyncError, markSynced, markSyncing, setPendingCount } from './status';

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

/** The seven syncable collections, mapped to their server payload keys, in dependency order. */
export const SYNCABLE = [
  { collection: 'ingredients', serverKey: 'ingredients', household: true, parentOf: [] },
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
type ServerRow = Row & { updated_at?: string | null; deleted_at?: string | null };
type Rejection = { id: string | null; code: string; message: string };
export type SyncResponse = {
  cursor: number;
  household_id: number;
  changes: Record<string, ServerRow[]>;
  rejected?: Record<string, Rejection[]>;
  remaps?: Record<string, Record<string, string>>;
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
  ensureChangeTracking();

  appStateSub = AppState.addEventListener('change', handleAppStateChange);
  foreground = AppState.currentState === 'active';
  bumpActivity();
  schedulePoll();

  updatePending();
  void pushPull();
}

/**
 * Trigger a sync immediately (a "retry" tap on the status banner, or a
 * pull-to-refresh). Resolves once a full cycle that started after this call has
 * settled, so callers can drive a spinner; counts as activity so the fast poll
 * cadence stays warm afterwards.
 */
export async function syncNow(): Promise<void> {
  bumpActivity();
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
 * Bind this device to the given server household after the user switched,
 * created, or joined one. Binding to a different household than before wipes
 * the local copy (its rows stay on the server under the old household) and
 * pulls the new one fresh; binding for the first time keeps the local rows so
 * they upload.
 */
export async function adoptServerHousehold(householdId: number): Promise<void> {
  const bound = store$.meta.serverHouseholdId.get();
  if (bound !== null && bound !== householdId) {
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

  appStateSub?.remove();
  appStateSub = null;
  if (pollTimer) clearTimeout(pollTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  pollTimer = debounceTimer = retryTimer = null;
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
      // A row re-created under a deleted id supersedes its tombstone.
      if (store$.meta.tombstones[collection][uuid].get()) {
        store$.meta.tombstones[collection][uuid].delete();
      }
    }
    touched = true;
  }

  if (touched) {
    bumpActivity();
    updatePending();
    if (started) {
      scheduleSync();
      schedulePoll(); // re-arm at the now-active cadence so peer edits pull fast
    }
  }
}

function scheduleSync(): void {
  if (!started) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void pushPull(), DEBOUNCE_MS);
}

function scheduleRetry(): void {
  if (!started) return;
  if (retryTimer) clearTimeout(retryTimer);
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryAttempt);
  const jitter = backoff * 0.25 * Math.random();
  retryAttempt += 1;
  retryTimer = setTimeout(() => void pushPull(), backoff + jitter);
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

function pushPull(): Promise<void> {
  if (inFlight) {
    rerun = true;
    return inFlight;
  }
  const request = getSyncRequest();
  if (!request || !started) return Promise.resolve(); // signed out

  rerun = false;
  inFlight = runCycle(request).finally(() => {
    inFlight = null;
    updatePending();
    if (started && (rerun || hasPending())) scheduleSync();
  });
  return inFlight;
}

async function runCycle(request: SyncRequest): Promise<void> {
  // First connect surfaces errors (the user just linked an account and expects
  // sync to start); routine background pulls stay quiet.
  let hasPush = store$.meta.cursor.get() === null;

  try {
    const ready = await prepareFirstSync(request);
    if (!ready || !started) return;

    hasPush = hasPush || hasPending();
    if (hasPush) markSyncing();

    let rejected = 0;
    let received = 0;
    // Push in dependency-ordered chunks; the last request also carries the pull.
    for (const snapshot of collectPushChunks()) {
      const response = await timed<SyncResponse>(request, '/sync', {
        method: 'POST',
        body: {
          cursor: store$.meta.cursor.get(),
          household_id: store$.meta.serverHouseholdId.get(),
          changes: snapshot.changes,
        },
      });
      if (!started) return; // signed out mid-flight: don't touch the store

      const applied = applyResponse(snapshot, response);
      rejected += applied.rejected;
      received += applied.received;
    }

    retryAttempt = 0; // connectivity restored — reset the backoff
    quietPulls = hasPush || received > 0 ? 0 : quietPulls + 1;
    markSynced(rejected);
  } catch (error) {
    if (!started) return;
    if (error instanceof ApiError && error.status === 409 && isHouseholdMismatch(error.body)) {
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
async function prepareFirstSync(request: SyncRequest): Promise<boolean> {
  if (store$.meta.cursor.get() !== null) return true; // already linked

  const me = await timed<{ current_household: { id: number } | null }>(request, '/me');
  if (!started) return false;
  const active = me?.current_household?.id;
  if (!active) return false; // wait for the user to create/join one

  const bound = store$.meta.serverHouseholdId.get();
  if (bound !== null && bound !== active) {
    resetLocalDataForHousehold(active);
  } else {
    store$.meta.serverHouseholdId.set(active);
  }
  seedOutboxFromLocal();
  return true;
}

/** Mark every existing local row dirty so the first sync uploads it. */
function seedOutboxFromLocal(): void {
  batch(() => {
    for (const { collection } of SYNCABLE) {
      for (const uuid of Object.keys(node(collection).get() ?? {})) {
        if (!store$.meta.tombstones[collection][uuid].get()) {
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
  applyRemaps(response.remaps ?? {});
  const received = applyRemote(response.changes ?? {});
  // Only write when something moved: every store write is a persist to disk,
  // and an idle poll that brings back nothing must not cost one.
  if (store$.meta.cursor.get() !== response.cursor) {
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
  const ingredientRemaps = remaps.ingredients ?? {};
  const entries = Object.entries(ingredientRemaps);
  if (entries.length === 0) return;

  batch(() => {
    for (const [from, to] of entries) {
      for (const collection of ['dinnerItems', 'shoppingListItems'] as const) {
        for (const row of Object.values(node(collection).get() ?? {}) as Row[]) {
          if (row.ingredient_id === from) {
            node(collection)[row.id].assign({ ingredient_id: to, updated_at: nowIso() });
          }
        }
      }
    }
  });

  applyingRemote = true;
  try {
    batch(() => {
      for (const [from] of entries) {
        if (store$.ingredients[from].get()) store$.ingredients[from].delete();
        store$.meta.dirty.ingredients[from].delete();
        store$.meta.tombstones.ingredients[from].delete();
      }
    });
  } finally {
    applyingRemote = false;
  }
}

/** Fold pulled rows into the store; returns how many rows the server sent. */
function applyRemote(changes: Record<string, ServerRow[]>): number {
  let received = 0;
  applyingRemote = true;
  try {
    batch(() => {
      for (const { collection, serverKey, household, parentOf } of SYNCABLE) {
        for (const row of changes[serverKey] ?? []) {
          if (typeof row?.id !== 'string') continue;
          received += 1;
          const uuid = row.id;
          // A row we've locally edited or deleted wins until it's pushed.
          if (store$.meta.dirty[collection][uuid].get()) continue;
          if (store$.meta.tombstones[collection][uuid].get()) continue;

          if (row.deleted_at != null) {
            if (node(collection)[uuid].get()) node(collection)[uuid].delete();
            // Mirror the local cascade so no orphaned children linger.
            for (const link of parentOf) {
              const [child, fk] = link.split(':');
              for (const childRow of Object.values(node(child).get() ?? {}) as Row[]) {
                if (childRow[fk] === uuid) node(child)[childRow.id].delete();
              }
            }
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
  return received;
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

export function hasPending(): boolean {
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

// Only used for the odd server-key lookup in tests/tooling; kept exported so the
// mapping has one source of truth.
export function collectionForServerKey(serverKey: string): string | undefined {
  return BY_SERVER_KEY.get(serverKey)?.collection;
}
