import { when, type ObservableParam } from '@legendapp/state';
import { observablePersistSqlite } from '@legendapp/state/persist-plugins/expo-sqlite';
import { syncObservable } from '@legendapp/state/sync';
import Storage from 'expo-sqlite/kv-store';

import { store$ } from './collections';
import { PERSIST_PREFIX, PERSISTED_KEYS, splitLegacyBlob, type KvStorage } from './persistence-layout';

/**
 * Persist the store to the expo-sqlite synchronous key-value store, one row per
 * top-level collection.
 *
 * Why per collection and not one blob: the sqlite persist plugin re-serialises
 * the whole persisted tree and writes it synchronously on *every* change. With
 * a single root row that meant a checkbox tap re-stringified every ingredient,
 * dinner and plan on the device, and the cost grew with lifetime data. With one
 * row per collection a change only re-serialises the collection it touched
 * (`meta` too, for the sync outbox — small).
 *
 * This is local persistence ONLY — no network. Cloud sync is a separate layer
 * (`@/lib/sync`) that watches the same observables.
 */

// Installs that persisted before the split hold a single `food-app-local` row.
// Split it into the per-collection rows once, before any of them is loaded, so
// the upgrade is invisible to the rest of the app.
splitLegacyBlob(Storage as KvStorage);

const plugin = observablePersistSqlite(Storage);

const states = PERSISTED_KEYS.map((key) =>
  // Indexing by a union of keys yields a union of observable types, which the
  // generic signature can't unify; each is a plain object node.
  syncObservable(store$[key] as ObservableParam<object>, {
    persist: {
      name: `${PERSIST_PREFIX}.${key}`,
      plugin,
    },
  }),
);

/**
 * Resolves once every persisted collection has been loaded back into `store$`.
 * Nothing should read the collections before this resolves (until then they
 * hold their empty defaults). The root `StoreProvider` gates first render on it.
 */
export const whenHydrated: Promise<unknown> = Promise.all(
  states.map((state$) => when(state$.isPersistLoaded)),
);

/**
 * "Every collection hydrated" — reads each collection's sync state, so inside a
 * `useValue` selector it re-evaluates as the loads complete.
 */
export function isStoreHydrated(): boolean {
  return states.every((state$) => state$.isPersistLoaded.get());
}
