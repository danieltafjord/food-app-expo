import { syncState, when } from '@legendapp/state';
import { observablePersistSqlite } from '@legendapp/state/persist-plugins/expo-sqlite';
import { syncObservable } from '@legendapp/state/sync';
import Storage from 'expo-sqlite/kv-store';

import { store$ } from './collections';

/**
 * Persist the whole store to the expo-sqlite synchronous key-value store.
 *
 * This is local persistence ONLY — no network. The same observables get
 * wrapped with `syncedCrud` in Phase 2 to add opt-in cloud sync (see
 * `@/lib/sync`). The kv-store persists serialized observable trees, which is
 * why the store is modelled as id-keyed collections rather than SQL tables.
 */
syncObservable(store$, {
  persist: {
    name: 'food-app-local',
    plugin: observablePersistSqlite(Storage),
  },
});

/**
 * Resolves once the persisted state has been loaded back into `store$`.
 * Nothing should read the collections before this resolves (until then they
 * hold their empty defaults). The root `StoreProvider` gates first render on it.
 */
export const whenHydrated: Promise<unknown> = when(syncState(store$).isPersistLoaded);
