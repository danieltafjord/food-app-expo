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
import { store$ } from '@/lib/store/collections';
import { createDinner, deleteDinner, setDinnerItems } from '@/lib/store/dinners';
import { createIngredient } from '@/lib/store/ingredients';
import { setSyncAuth } from '@/lib/sync/auth-bridge';
import {
  __pollDelayForTests,
  __resetEngineForTests,
  adoptServerHousehold,
  connectCollections,
  disconnectCollections,
  ensureChangeTracking,
  hasPending,
  syncNow,
  type SyncResponse,
} from '@/lib/sync/engine';
import { syncStatus$ } from '@/lib/sync/status';

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

  it('surfaces rejected rows without retrying them forever', async () => {
    ensureChangeTracking();
    const server = fakeServer();
    await connect(server);
    const dinner = createDinner({ name: 'Bad' });

    server.handlers.push(() => ({
      ...emptySync(),
      rejected: { dinners: [{ id: dinner, code: 'invalid', message: 'nope' }] },
    }));
    await syncNow();

    expect(hasPending()).toBe(false);
    expect(syncStatus$.rejected.get()).toBe(1);
    expect(syncStatus$.phase.get()).toBe('idle');
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
