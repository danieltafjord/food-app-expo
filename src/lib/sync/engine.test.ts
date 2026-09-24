/* eslint-disable import/first -- jest.mock must precede the imports it stubs */
/**
 * Sync engine contract tests. The store is the real Legend-State store (no
 * persistence: `whenHydrated` is mocked to resolve immediately); the network is
 * a scripted `request` fake wired through the auth bridge.
 */
jest.mock('@/lib/store/persistence', () => ({ whenHydrated: Promise.resolve() }));
jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
}));

import { ApiError } from '@/lib/api/client';
import { setupAccount } from '@/lib/auth/account-setup';
import { store$ } from '@/lib/store/collections';
import { saveDinnerCategory } from '@/lib/store/dinner-categories';
import { createDinner, deleteDinner, setDinnerItems } from '@/lib/store/dinners';
import { createIngredient, deleteIngredient } from '@/lib/store/ingredients';
import { addShoppingItem, createShoppingList } from '@/lib/store/shopping-lists';
import { setSyncAuth } from '@/lib/sync/auth-bridge';
import {
  __pollDelayForTests,
  __resetEngineForTests,
  adoptServerHousehold,
  connectCollections,
  disconnectCollections,
  ensureChangeTracking,
  ensureSyncedBeforeRebind,
  hasPending,
  getSyncFailures,
  SyncPendingError,
  syncNow,
  type SyncResponse,
} from '@/lib/sync/engine';
import { resetSyncStatus, syncStatus$ } from '@/lib/sync/status';

declare const global: { __DEV__?: boolean };
global.__DEV__ = false;

type Call = { path: string; body?: any };

/** A scripted server: records every request and answers from a queue of handlers. */
function fakeServer(handlers: ((call: Call) => unknown)[] = []) {
  const calls: Call[] = [];
  const request = async <T,>(path: string, options: any = {}): Promise<T> => {
    const call = { path, body: options.body };
    calls.push(call);
    const handler = handlers.shift() ?? defaultHandler;
    return handler(call) as T;
  };
  return { calls, request, handlers };
}

let cursor = 10;
const me = { current_household: { id: 7 } };
const emptySync = (): SyncResponse => ({
  cursor: ++cursor,
  household_id: me.current_household.id,
  changes: {},
  rejected: {},
  remaps: {},
});
const defaultHandler = (call: Call) => (call.path === '/me' ? me : emptySync());

function resetStore() {
  store$.set({
    settings: { theme: 'system', locale: 'en' },
    meta: {
      schemaVersion: 3,
      localHouseholdId: 'local-h',
      accountId: 1,
      cursor: null,
      serverHouseholdId: null,
      dirty: {},
      tombstones: {},
    },
    households: {
      'local-h': { id: 'local-h', name: 'My Kitchen', default_servings: 2, created_at: 'x', updated_at: 'x' },
    },
    dinnerCategories: {},
    ingredients: {},
    dinners: {},
    dinnerItems: {},
    dinnerPlans: {},
    planEntries: {},
    shoppingLists: {},
    shoppingListItems: {},
  } as any);
  syncStatus$.set({ phase: 'idle', lastSyncedAt: null, pending: 0, error: null, rejected: 0 });
}

beforeEach(() => {
  jest.useFakeTimers();
  __resetEngineForTests();
  resetStore();
  cursor = 10;
  me.current_household.id = 7;
});

afterEach(() => {
  __resetEngineForTests();
  setSyncAuth(null);
  jest.useRealTimers();
});

async function connect(server: ReturnType<typeof fakeServer>) {
  setSyncAuth(server.request);
  await connectCollections();
  // connectCollections kicks off a cycle; wait for it to settle.
  await syncNow();
}

describe('change tracking', () => {
  it('records edits and deletes in the outbox even while signed out', () => {
    ensureChangeTracking();
    const id = createDinner({ name: 'Tacos' });
    expect(store$.meta.dirty.dinners[id].get()).toBe(true);
    expect(hasPending()).toBe(true);

    deleteDinner(id);
    expect(store$.meta.dirty.dinners[id].get()).toBeUndefined();
    expect(typeof store$.meta.tombstones.dinners[id].get()).toBe('string');
  });
});

describe('first sync', () => {
  it('automatically uploads guest data after household setup without a manual create action', async () => {
    ensureChangeTracking();
    const dinner = createDinner({ name: 'Tacos' });
    const server = fakeServer([
      () => ({ id: 1, current_household: null }),
      () => ({ id: 7, name: 'My Kitchen', default_servings: 2 }),
    ]);
    const account = await setupAccount(server.request, {
      defer: false, name: 'My Kitchen', defaultServings: 2, signal: new AbortController().signal,
    });
    expect(account.current_household?.id).toBe(7);
    expect(syncStatus$.lastSyncedAt.get()).toBeNull();
    await connect(server);
    const push = server.calls.find((call) => call.path === '/sync');
    expect(push?.body.changes.dinners).toEqual(expect.arrayContaining([expect.objectContaining({ id: dinner })]));
    expect(hasPending()).toBe(false);
    expect(syncStatus$.lastSyncedAt.get()).not.toBeNull();
  });

  it('clears a previous account’s sync confirmation before a new account starts setup', async () => {
    await connect(fakeServer());
    expect(syncStatus$.lastSyncedAt.get()).not.toBeNull();
    resetSyncStatus();
    expect(syncStatus$.get()).toMatchObject({ phase: 'idle', lastSyncedAt: null, error: null, rejected: 0 });
  });

  it('binds to the active household, uploads every local row, and stores the cursor', async () => {
    ensureChangeTracking();
    const ingredient = createIngredient({ name: 'Beef' });
    const dinner = createDinner({ name: 'Bolognese' });
    setDinnerItems(dinner, [{ ingredient_id: ingredient, quantity: 500, unit: 'g' }]);
    // Pretend these rows are old: nothing is dirty yet.
    store$.meta.dirty.set({});

    const server = fakeServer();
    await connect(server);

    const sync = server.calls.find((c) => c.path === '/sync')!;
    expect(server.calls[0].path).toBe('/me');
    expect(sync.body.cursor).toBeNull();
    expect(sync.body.household_id).toBe(7);
    expect(sync.body.changes.ingredients).toHaveLength(1);
    expect(sync.body.changes.dinners).toHaveLength(1);
    expect(sync.body.changes.dinner_items).toHaveLength(1);
    expect(store$.meta.cursor.get()).toBe(cursor); // the last response's cursor
    expect(store$.meta.serverHouseholdId.get()).toBe(7);
    expect(hasPending()).toBe(false);
  });

  it('waits when the account has no household yet', async () => {
    const noHousehold = () => ({ current_household: null });
    const server = fakeServer([noHousehold, noHousehold]);
    setSyncAuth(server.request);
    await connectCollections();
    // The launch cycle is deferred past the splash reveal, and runs by itself.
    expect(server.calls).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1500);
    await syncNow();
    // Both cycles stop at /me: nothing is pushed until a household exists.
    expect(server.calls.map((c) => c.path)).toEqual(['/me', '/me']);
    expect(store$.meta.cursor.get()).toBeNull();
  });
});

describe('push / pull', () => {
  it('syncs offline ingredient deletion along with every referenced row', async () => {
    ensureChangeTracking();
    const ingredient = createIngredient({ name: 'Eggs' });
    const dinner = createDinner({ name: 'Omelette' });
    setDinnerItems(dinner, [{ ingredient_id: ingredient }]);
    const dinnerItem = Object.values(store$.dinnerItems.get())[0];
    const list = createShoppingList('Groceries');
    const shoppingItem = addShoppingItem(list, { ingredient_id: ingredient });

    deleteIngredient(ingredient);
    const server = fakeServer();
    await connect(server);

    const push = server.calls.find((call) => call.path === '/sync')!;
    for (const [key, id] of [['ingredients', ingredient], ['dinner_items', dinnerItem.id], ['shopping_list_items', shoppingItem]]) {
      expect(push.body.changes[key]).toEqual([{ id, updated_at: expect.any(String), deleted_at: expect.any(String) }]);
    }
    expect(hasPending()).toBe(false);
  });

  it('removes remote ingredient references including a shopping row added during sync', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const ingredient = createIngredient({ name: 'Eggs' });
    const dinner = createDinner({ name: 'Omelette' });
    setDinnerItems(dinner, [{ ingredient_id: ingredient }]);
    const list = createShoppingList('Groceries');
    addShoppingItem(list, { ingredient_id: ingredient });
    await syncNow();

    server.handlers.push(() => {
      addShoppingItem(list, { ingredient_id: ingredient });
      return { ...emptySync(), changes: { ingredients: [{ id: ingredient, deleted_at: '2026-09-22T00:00:00Z' }] } };
    });
    await syncNow();

    expect(store$.ingredients[ingredient].get()).toBeUndefined();
    expect(Object.values(store$.dinnerItems.get())).toEqual([]);
    expect(Object.values(store$.shoppingListItems.get())).toEqual([]);
    expect(store$.dinners[dinner].get()).toBeDefined();
    expect(store$.shoppingLists[list].get()).toBeDefined();
    expect(hasPending()).toBe(false);
  });

  it('sends tombstones as bare rows and clears them on success', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);

    const dinner = createDinner({ name: 'Old' });
    await syncNow();
    deleteDinner(dinner);
    await syncNow();

    const last = server.calls.at(-1)!;
    expect(last.body.changes.dinners).toEqual([
      { id: dinner, updated_at: expect.any(String), deleted_at: expect.any(String) },
    ]);
    expect(store$.meta.tombstones.dinners.get()).toEqual({});
  });

  it('adopts the server copy when it loses a conflict, instead of keeping the rejected edit', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const dinner = createDinner({ name: 'Mine' });

    // The server kept a peer's newer version and echoes it back.
    server.handlers.push(() => ({
      ...emptySync(),
      changes: {
        dinners: [
          {
            id: dinner,
            name: 'Peer wins',
            default_servings: 4,
            notes: null,
            created_at: 'x',
            updated_at: '2999-01-01T00:00:00.000Z',
            deleted_at: null,
          },
        ],
      },
    }));
    await syncNow();

    expect(store$.dinners[dinner].name.get()).toBe('Peer wins');
    expect(store$.dinners[dinner].household_id.get()).toBe('local-h');
    expect(store$.meta.dirty.dinners[dinner].get()).toBeUndefined();
  });

  it('keeps a row edited mid-flight dirty and does not overwrite it with the echo', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const dinner = createDinner({ name: 'v1' });

    server.handlers.push((call) => {
      // Edit while the request is on the wire.
      store$.dinners[dinner].assign({ name: 'v2', updated_at: '2999-01-01T00:00:00.000Z' });
      return {
        ...emptySync(),
        changes: { dinners: [{ ...call.body.changes.dinners[0], deleted_at: null }] },
      };
    });
    await syncNow();

    expect(store$.dinners[dinner].name.get()).toBe('v2');
    expect(store$.meta.dirty.dinners[dinner].get()).toBe(true);
  });

  it('applies account erasure over an edit made while the request is in flight', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const dinner = createDinner({ name: 'Shared recipe', notes: 'Personal information' });

    server.handlers.push((call) => {
      store$.dinners[dinner].assign({ notes: 'Still contains personal information', updated_at: '2999-01-01T00:00:00.000Z' });
      return {
        ...emptySync(),
        changes: { dinners: [{ ...call.body.changes.dinners[0], notes: null, erasure_version: 12, deleted_at: null }] },
      };
    });
    await syncNow();

    expect(store$.dinners[dinner].notes.get()).toBeNull();
    expect(hasPending()).toBe(false);

    // New, deliberate edits after the erasure carry its version to the server.
    store$.dinners[dinner].assign({ name: 'New name', updated_at: '2999-02-01T00:00:00.000Z' });
    await syncNow();
    expect(server.calls.at(-1)!.body.changes.dinners[0]).toMatchObject({ notes: null, erasure_version: 12 });
  });

  it('does not overwrite a new edit when the same erasure version is echoed again', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const dinner = createDinner({ name: 'Shared recipe' });
    server.handlers.push((call) => ({
      ...emptySync(),
      changes: { dinners: [{ ...call.body.changes.dinners[0], erasure_version: 12, deleted_at: null }] },
    }));
    await syncNow();
    store$.dinners[dinner].assign({ name: 'New name', updated_at: '2999-01-01T00:00:00.000Z' });
    server.handlers.push((call) => {
      store$.dinners[dinner].assign({ name: 'Newest name', updated_at: '2999-02-01T00:00:00.000Z' });
      return { ...emptySync(), changes: { dinners: [{ ...call.body.changes.dinners[0], deleted_at: null }] } };
    });
    await syncNow();
    expect(store$.dinners[dinner].name.get()).toBe('Newest name');
    expect(hasPending()).toBe(true);
  });

  it('erases dirty parent and child rows even when their upload chunk has not been sent', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    for (let i = 0; i < 300; i += 1) createIngredient({ name: `Queued ${i}` });
    const ingredient = createIngredient({ name: 'Beef' });
    const dinner = createDinner({ name: 'Personal recipe' });
    setDinnerItems(dinner, [{ ingredient_id: ingredient, quantity: 1, unit: 'g' }]);
    const erased = () => ({ ...emptySync(), changes: {
      dinners: [{ id: dinner, updated_at: '2026-01-01T00:00:00.000Z', deleted_at: '2026-01-01T00:00:00.000Z', erasure_version: 12 }],
    } });
    server.handlers.push(() => {
      const response = erased();
      // Also edit the child while its parent is being erased remotely.
      const child = Object.values(store$.dinnerItems.get())[0];
      store$.dinnerItems[child.id].assign({ unit: 'private text', updated_at: '2999-01-01T00:00:00.000Z' });
      return response;
    }, erased);
    await syncNow();
    expect(store$.dinners[dinner].get()).toBeUndefined();
    expect(Object.values(store$.dinnerItems.get())).toHaveLength(0);
    expect(hasPending()).toBe(false);
  });

  it('applies remote tombstones with a local cascade and never re-tombstones them', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const ingredient = createIngredient({ name: 'Beef' });
    const dinner = createDinner({ name: 'Bolognese' });
    setDinnerItems(dinner, [{ ingredient_id: ingredient, quantity: 1, unit: 'g' }]);
    await syncNow();

    server.handlers.push(() => ({
      ...emptySync(),
      changes: { dinners: [{ id: dinner, deleted_at: '2026-01-01T00:00:00.000Z', updated_at: 'x' }] },
    }));
    await syncNow();

    expect(store$.dinners[dinner].get()).toBeUndefined();
    expect(Object.values(store$.dinnerItems.get())).toHaveLength(0);
    expect(store$.meta.tombstones.dinners.get() ?? {}).toEqual({});
    expect(hasPending()).toBe(false);
  });

  it('recognises its own echo despite microsecond timestamps and leaves the row untouched', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const dinner = createDinner({ name: 'Soup' });
    const before = store$.dinners[dinner].peek();

    const micro = (value: unknown) => String(value).replace(/\.(\d{3})Z$/, '.$1000Z');
    server.handlers.push((call) => {
      const pushed = call.body.changes.dinners[0];
      return {
        ...emptySync(),
        changes: { dinners: [{ ...pushed, created_at: micro(pushed.created_at), updated_at: micro(pushed.updated_at), deleted_at: null, erasure_version: 0 }] },
      };
    });
    await syncNow();

    expect(store$.dinners[dinner].peek()).toBe(before);
    expect(hasPending()).toBe(false);

    // A newer server copy still lands.
    server.handlers.push(() => ({
      ...emptySync(),
      changes: { dinners: [{ ...before, name: 'Soup of the day', updated_at: '2999-01-01T00:00:00.000000Z', deleted_at: null, erasure_version: 0 }] },
    }));
    await syncNow();
    expect(store$.dinners[dinner].name.get()).toBe('Soup of the day');
  });

  it('cascades several remote parent deletions from one pull', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const ingredient = createIngredient({ name: 'Beef' });
    const first = createDinner({ name: 'Bolognese' });
    const second = createDinner({ name: 'Chili' });
    const kept = createDinner({ name: 'Tacos' });
    for (const dinner of [first, second, kept]) {
      setDinnerItems(dinner, [{ ingredient_id: ingredient, quantity: 1, unit: 'g' }]);
    }
    await syncNow();

    server.handlers.push(() => ({
      ...emptySync(),
      changes: { dinners: [first, second].map((id) => ({ id, deleted_at: '2026-01-01T00:00:00.000Z', updated_at: 'x' })) },
    }));
    await syncNow();

    expect(Object.values(store$.dinnerItems.get()).map((item) => item.dinner_id)).toEqual([kept]);
    expect(hasPending()).toBe(false);
  });

  it('rewrites references for merged ingredients and drops the duplicate', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const duplicate = createIngredient({ name: 'melk' });
    const dinner = createDinner({ name: 'Grøt' });
    setDinnerItems(dinner, [{ ingredient_id: duplicate, quantity: 1, unit: 'l' }]);

    server.handlers.push(() => ({
      ...emptySync(),
      remaps: { ingredients: { [duplicate]: 'survivor' } },
      changes: {
        ingredients: [
          { id: 'survivor', name: 'Melk', default_unit: null, category: 'dairy', created_at: 'x', updated_at: 'x', deleted_at: null },
        ],
      },
    }));
    await syncNow();

    expect(store$.ingredients[duplicate].get()).toBeUndefined();
    expect(store$.ingredients.survivor.name.get()).toBe('Melk');
    const item = Object.values(store$.dinnerItems.get())[0];
    expect(item.ingredient_id).toBe('survivor');
  });

  it('chunks a large outbox in dependency order', async () => {
    ensureChangeTracking();
    for (let i = 0; i < 350; i += 1) createIngredient({ name: `Ing ${i}` });
    const dinner = createDinner({ name: 'Big' });

    const server = fakeServer();
    await connect(server);

    const syncs = server.calls.filter((c) => c.path === '/sync');
    expect(syncs.length).toBeGreaterThanOrEqual(2);
    expect(syncs[0].body.changes.ingredients).toHaveLength(300);
    expect(syncs[0].body.changes.dinners).toBeUndefined();
    const dinnerChunk = syncs.find((c) => c.body.changes.dinners);
    expect(dinnerChunk!.body.changes.dinners[0].id).toBe(dinner);
    expect(hasPending()).toBe(false);
  });

  it('retains rejected changes across pulls and restarts, blocks rebind, and retries after correction', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const dinner = createDinner({ name: 'Bad' });
    server.handlers.push(() => ({ ...emptySync(),
      rejected: { dinners: [{ id: dinner, code: 'invalid', message: 'Name too long' }] },
    }));
    await syncNow();
    expect(hasPending()).toBe(true);
    expect(getSyncFailures()).toEqual([{ collection: 'dinners', id: dinner, name: 'Bad', message: 'Name too long' }]);
    await syncNow();
    expect(server.calls.at(-1)?.body.changes).toEqual({});
    expect(syncStatus$.rejected.get()).toBe(1);
    await expect(ensureSyncedBeforeRebind()).rejects.toBeInstanceOf(SyncPendingError);
    await expect(adoptServerHousehold(8)).rejects.toBeInstanceOf(SyncPendingError);
    __resetEngineForTests();
    await connect(server);
    expect(hasPending()).toBe(true);
    expect(syncStatus$.rejected.get()).toBe(1);
    store$.dinners[dinner].assign({ name: 'Corrected', updated_at: '2026-01-01T00:00:01.000Z' });
    await syncNow();
    expect(server.calls.at(-1)?.body.changes.dinners[0].name).toBe('Corrected');
    expect(getSyncFailures()).toEqual([]);
    expect(hasPending()).toBe(false);
  });
});

describe('failures and state transitions', () => {
  it('reports an error and keeps the outbox when the server is unreachable', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const dinner = createDinner({ name: 'Offline' });

    server.handlers.push(() => {
      throw new Error('Network request failed');
    });
    await syncNow();

    expect(store$.meta.dirty.dinners[dinner].get()).toBe(true);
    expect(syncStatus$.phase.get()).toBe('error');
    expect(syncStatus$.error.get()).toBe('Network request failed');
    const attempts = server.calls.length;
    await jest.advanceTimersByTimeAsync(1500);
    expect(server.calls).toHaveLength(attempts); // the debounce must not defeat retry backoff
  });

  it('re-binds to the household the server reports on a mismatch', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    createDinner({ name: 'Household A' });
    store$.meta.dirty.set({});

    server.handlers.push(() => {
      throw new ApiError(409, 'mismatch', undefined, { code: 'household_mismatch', household_id: 8 });
    });
    await syncNow();

    expect(store$.meta.serverHouseholdId.get()).toBe(8);
    expect(store$.meta.cursor.get()).toBeNull();
    expect(Object.values(store$.dinners.get())).toHaveLength(0);
    expect(store$.meta.localHouseholdId.get()).not.toBe('');
  });

  it('preserves unsynced edits when another device switches the household', async () => {
    const server = fakeServer();
    await connect(server);
    const dinner = createDinner({ name: 'Unsynced' });
    server.handlers.push(() => {
      throw new ApiError(409, 'mismatch', undefined, { code: 'household_mismatch', household_id: 8 });
    });
    await syncNow();
    expect(store$.dinners[dinner].name.get()).toBe('Unsynced');
    expect(store$.meta.serverHouseholdId.get()).toBe(7);
    expect(hasPending()).toBe(true);
    expect(syncStatus$.phase.get()).toBe('error');
  });

  it('refuses to discard edits made while a household switch was in flight', async () => {
    const server = fakeServer();
    await connect(server);
    const dinner = createDinner({ name: 'Just edited' });
    await expect(adoptServerHousehold(8)).rejects.toBeInstanceOf(SyncPendingError);
    expect(store$.dinners[dinner].get()).toBeDefined();
  });

  it('wipes and re-pulls when adopting a different household, keeps data when adopting the first', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const dinner = createDinner({ name: 'Keep' });
    await syncNow();

    await adoptServerHousehold(7); // same household: nothing happens
    expect(store$.dinners[dinner].get()).toBeDefined();

    me.current_household.id = 9; // the switch already happened server-side
    await adoptServerHousehold(9);
    expect(store$.dinners[dinner].get()).toBeUndefined();
    expect(store$.meta.serverHouseholdId.get()).toBe(9);
    const last = server.calls.at(-1)!;
    expect(last.body.cursor).toBeNull();
    expect(last.body.household_id).toBe(9);
  });

  it('refuses to rebind while a bound device has changes it cannot push', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    createDinner({ name: 'Unsynced' });

    server.handlers.push(() => {
      throw new Error('Network request failed');
    });
    await expect(ensureSyncedBeforeRebind()).rejects.toBeInstanceOf(SyncPendingError);
    expect(hasPending()).toBe(true);

    // Back online: the outbox drains and the rebind may go ahead.
    await expect(ensureSyncedBeforeRebind()).resolves.toBeUndefined();
    expect(hasPending()).toBe(false);
  });

  it('lets an unbound device rebind with pending rows, since they upload into the new household', async () => {
    ensureChangeTracking();
    createDinner({ name: 'Made before signing in' });
    expect(store$.meta.serverHouseholdId.get()).toBeNull();

    await expect(ensureSyncedBeforeRebind()).resolves.toBeUndefined();
    expect(hasPending()).toBe(true);
  });

  it('ignores a response that lands after sign-out', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const before = store$.meta.cursor.get();

    server.handlers.push(() => {
      disconnectCollections();
      return emptySync();
    });
    await syncNow();

    expect(store$.meta.cursor.get()).toBe(before);
  });

  it('ignores a previous session response even after reconnecting', async () => {
    const server = fakeServer();
    await connect(server);
    const before = store$.meta.cursor.get();
    server.handlers.push(async () => {
      disconnectCollections();
      setSyncAuth(fakeServer().request);
      await connectCollections();
      return { ...emptySync(), cursor: 999, household_id: 999 };
    });
    await syncNow();
    expect(store$.meta.cursor.get()).toBe(before);
    expect(store$.meta.serverHouseholdId.get()).toBe(7);
  });

  it('keeps tracking deletes while signed out so they sync on the next session', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const dinner = createDinner({ name: 'Gone later' });
    await syncNow();

    disconnectCollections();
    setSyncAuth(null);
    deleteDinner(dinner);
    expect(hasPending()).toBe(true);

    await connect(server);
    const push = server.calls.filter((c) => c.path === '/sync' && c.body.changes.dinners).at(-1)!;
    expect(push.body.cursor).not.toBeNull(); // resumed as a delta, not a first sync
    expect(push.body.changes.dinners[0]).toMatchObject({ id: dinner, deleted_at: expect.any(String) });
    expect(hasPending()).toBe(false);
  });
});

describe('idle poll and cursor writes', () => {
  it('does not rewrite the cursor or household when a pull brings nothing new', async () => {
    const server = fakeServer();
    await connect(server);
    const cursorBefore = store$.meta.cursor.get();
    expect(cursorBefore).not.toBeNull();

    // Same cursor echoed back: nothing changed on the server.
    let writes = 0;
    const dispose = store$.meta.onChange(() => {
      writes += 1;
    });
    server.handlers.push(() => ({
      cursor: cursorBefore as number,
      household_id: me.current_household.id,
      changes: {},
    }));
    await syncNow();
    dispose();

    expect(store$.meta.cursor.get()).toBe(cursorBefore);
    expect(writes).toBe(0);
  });

  it('backs off the idle cadence after a quiet pull and resets on local activity', async () => {
    const server = fakeServer();
    await connect(server);
    // Push an edit so the last cycle carried something (a push resets the
    // quiet-pull count) — `connect` itself ends on an empty pull.
    createDinner({ name: 'Bolognese' });
    await syncNow();
    const cursorNow = store$.meta.cursor.get() as number;
    const quiet = () => ({ cursor: cursorNow, household_id: me.current_household.id, changes: {} });

    // Recently active → fast cadence; idle → base idle cadence.
    expect(__pollDelayForTests()).toBe(8_000);
    jest.setSystemTime(Date.now() + 61_000);
    expect(__pollDelayForTests()).toBe(30_000);

    // One pull that brings nothing back doubles the idle wait.
    server.handlers.push(quiet);
    await syncNow();
    jest.setSystemTime(Date.now() + 61_000);
    expect(__pollDelayForTests()).toBe(60_000);

    // A local edit is activity: fast cadence again, and the backoff is reset.
    createDinner({ name: 'Tacos' });
    expect(__pollDelayForTests()).toBe(8_000);
    jest.setSystemTime(Date.now() + 61_000);
    expect(__pollDelayForTests()).toBe(30_000);
  });
});


it('clears a dirty child created while its parent is deleted remotely', async () => {
  const server = fakeServer();
  await connect(server);
  const dinner = createDinner({ name: 'Gone' });
  const ingredient = createIngredient({ name: 'Rice' });
  await syncNow();
  server.handlers.push(() => {
    setDinnerItems(dinner, [{ ingredient_id: ingredient, quantity: 100, unit: 'g' }]);
    return { ...emptySync(), changes: { dinners: [{ id: dinner, deleted_at: '2026-06-01T00:00:00Z' }] } };
  });
  await syncNow();
  expect(Object.values(store$.dinnerItems.get())).toEqual([]);
  expect(hasPending()).toBe(false);
  await syncNow();
  expect(server.calls.at(-1)?.body.changes).toEqual({});
});

it('preserves a mid-flight recipe item edit under its canonical identity', async () => {
  const server = fakeServer();
  await connect(server);
  const dinner = createDinner({ name: 'Rice' });
  const ingredient = createIngredient({ name: 'Rice' });
  setDinnerItems(dinner, [{ ingredient_id: ingredient, quantity: 100, unit: 'g' }]);
  const item = Object.values(store$.dinnerItems.get())[0];
  server.handlers.push(() => {
    store$.dinnerItems[item.id].assign({ quantity: 250, updated_at: '2030-01-01T00:00:00.000Z' });
    return { ...emptySync(), remaps: { dinner_items: { [item.id]: 'canonical' } }, changes: {
      dinner_items: [{ ...item, id: 'canonical' }, { ...item, deleted_at: '2026-01-01T00:00:00Z' }],
    } };
  });
  await syncNow();
  expect(store$.dinnerItems[item.id].get()).toBeUndefined();
  expect(store$.dinnerItems.canonical.quantity.get()).toBe(250);
  expect(store$.meta.dirty.dinnerItems.canonical.get()).toBe(true);
  await syncNow();
  expect(server.calls.at(-1)?.body.changes.dinner_items).toEqual([expect.objectContaining({ id: 'canonical', quantity: 250 })]);
  expect(hasPending()).toBe(false);
});

it('refreshes later chunks after ingredient identities are remapped', async () => {
  const server = fakeServer();
  await connect(server);
  const ingredient = createIngredient({ name: 'Duplicate' });
  for (let i = 0; i < 300; i++) createIngredient({ name: `Padding ${i}` });
  const dinner = createDinner({ name: 'Rice' });
  setDinnerItems(dinner, [{ ingredient_id: ingredient, quantity: 100, unit: 'g' }]);
  server.handlers.push(() => ({ ...emptySync(), remaps: { ingredients: { [ingredient]: 'canonical' } } }));
  await syncNow();
  const itemPush = server.calls.find((call) => call.body?.changes.dinner_items?.length);
  expect(itemPush?.body.changes.dinner_items[0].ingredient_id).toBe('canonical');
});


it('retries dependent rejections when their parent is corrected', async () => {
  const server = fakeServer();
  await connect(server);
  const dinner = createDinner({ name: 'Bad' });
  const ingredient = createIngredient({ name: 'Rice' });
  setDinnerItems(dinner, [{ ingredient_id: ingredient, quantity: 100, unit: 'g' }]);
  const item = Object.values(store$.dinnerItems.get())[0];
  server.handlers.push(() => ({ ...emptySync(), rejected: {
    dinners: [{ id: dinner, code: 'invalid', message: 'Invalid name' }],
    dinner_items: [{ id: item.id, code: 'unknown_parent', message: 'Unknown dinner' }],
  } }));
  await syncNow();
  expect(getSyncFailures()).toHaveLength(2);
  store$.dinners[dinner].assign({ name: 'Corrected', updated_at: '2030-01-01T00:00:00Z' });
  await syncNow();
  expect(server.calls.at(-1)?.body.changes.dinner_items).toHaveLength(1);
  expect(hasPending()).toBe(false);
});

it('retains rejected content and its error when an old item identity is redirected', async () => {
  const server = fakeServer();
  await connect(server);
  const dinner = createDinner({ name: 'Rice' });
  setDinnerItems(dinner, [{ ingredient_id: 'missing', quantity: 100, unit: 'g' }]);
  const item = Object.values(store$.dinnerItems.get())[0];
  server.handlers.push(() => ({ ...emptySync(),
    rejected: { dinner_items: [{ id: item.id, code: 'unknown_parent', message: 'Missing ingredient' }] },
    remaps: { dinner_items: { [item.id]: 'canonical' } },
    changes: { dinner_items: [{ ...item, id: 'canonical', ingredient_id: 'server-ingredient' }] },
  }));
  await syncNow();
  expect(store$.dinnerItems.canonical.ingredient_id.get()).toBe('missing');
  expect(getSyncFailures()).toEqual([expect.objectContaining({ id: 'canonical', message: 'Missing ingredient' })]);
  expect(hasPending()).toBe(true);
});

it('round trips category edits and explicit clearing through sync', async () => {
  ensureChangeTracking();
  const id = createDinner({ name: 'Soup', category: 'vegetarian' });
  const server = fakeServer();
  await connect(server);
  const upload = server.calls.find((call) => call.body?.changes?.dinners?.some((row: any) => row.id === id));
  expect(upload?.body.changes.dinners[0].category).toBe('vegetarian');
  const row = { ...store$.dinners[id].peek(), category: null };
  server.handlers.push(() => ({ ...emptySync(), changes: { dinners: [row] } }));
  await syncNow();
  expect(store$.dinners[id].category.peek()).toBeNull();
});

it('accepts old-server dinner rows without discarding a locally known category', async () => {
  const id = createDinner({ name: 'Soup', category: 'vegetarian' });
  const server = fakeServer();
  await connect(server);
  const { category: _category, ...row } = store$.dinners[id].peek();
  server.handlers.push(() => ({ ...emptySync(), changes: { dinners: [{ ...row, name: 'Renamed soup' }] } }));
  await syncNow();
  expect(store$.dinners[id].peek()).toMatchObject({ name: 'Renamed soup', category: 'vegetarian' });
});

it('uploads custom categories with their recipes and receives shared renames', async () => {
  ensureChangeTracking();
  const category = saveDinnerCategory('Quick')!;
  const dinner = createDinner({ name: 'Soup', category });
  const server = fakeServer();
  await connect(server);
  const upload = server.calls.find((call) => call.body?.changes?.dinner_categories?.length);
  expect(upload?.body.changes.dinner_categories[0]).toMatchObject({ id: category, name: 'Quick' });
  expect(upload?.body.changes.dinners[0]).toMatchObject({ id: dinner, category });
  server.handlers.push(() => ({ ...emptySync(), changes: { dinner_categories: [
    { ...store$.dinnerCategories[category].peek(), name: 'Weeknight' },
  ] } }));
  await syncNow();
  expect(store$.dinnerCategories[category].name.get()).toBe('Weeknight');
  expect(store$.dinners[dinner].category.get()).toBe(category);
});

it('clears a remotely deleted category while retaining a recipe edit made during sync', async () => {
  const category = saveDinnerCategory('Quick')!;
  const dinner = createDinner({ name: 'Soup', category });
  const server = fakeServer();
  await connect(server);
  server.handlers.push(() => {
    store$.dinners[dinner].assign({ name: 'My soup', updated_at: '2030-01-01T00:00:00Z' });
    return { ...emptySync(), changes: { dinner_categories: [{ id: category, deleted_at: '2026-09-24T10:00:00Z' }] } };
  });
  await syncNow();
  expect(store$.dinnerCategories[category].get()).toBeUndefined();
  expect(store$.dinners[dinner].get()).toMatchObject({ name: 'My soup', category: null });
});
