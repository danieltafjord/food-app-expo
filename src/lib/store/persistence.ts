import { when, type ObservableParam } from '@legendapp/state';
import { syncObservable } from '@legendapp/state/sync';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { AppState, Platform } from 'react-native';

import { store$ } from './collections';
import { PERSIST_PREFIX, PERSISTED_KEYS, splitLegacyBlob, type KvStorage } from './persistence-layout';
import { RowPersistPlugin, type RowOp, type RowStore } from './row-persist';

/**
 * Persist the store to SQLite, one row per entity (see `./row-persist`).
 *
 * Layout: a single `rows (tbl, key, json)` table in `food-app-store.db`, where
 * `tbl` is the persisted collection (`food-app-local.shoppingListItems`) and
 * `key` its top-level key (the row uuid, or `cursor` / `theme` for the scalar
 * tables). Writes are coalesced and asynchronous, so a tap never waits on disk;
 * the app flushes synchronously when it goes to the background.
 *
 * Upgrades are invisible: a pre-split single blob is first split into
 * per-collection kv rows (`splitLegacyBlob`), and each of those is imported
 * into the row table the first time it is loaded (`RowPersistPlugin`).
 *
 * This is local persistence ONLY — no network. Cloud sync is a separate layer
 * (`@/lib/sync`) that watches the same observables.
 */

const DB_NAME = 'food-app-store.db';

class SqliteRowStore implements RowStore {
  constructor(private readonly db: SQLiteDatabase) {
    // WAL lets the async writer commit without blocking the sync reads at
    // launch; NORMAL sync is durable across app crashes (not power loss), which
    // is the right trade for a cache of data that also lives on the server.
    db.execSync(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;' +
        'CREATE TABLE IF NOT EXISTS rows (tbl TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (tbl, key)) WITHOUT ROWID;',
    );
  }

  loadRows(tbl: string): { key: string; json: string }[] {
    return this.db.getAllSync<{ key: string; json: string }>(
      'SELECT key, json FROM rows WHERE tbl = ?',
      tbl,
    );
  }

  writeSync(clear: readonly string[], ops: readonly RowOp[]): void {
    this.db.withTransactionSync(() => {
      for (const tbl of clear) this.db.runSync('DELETE FROM rows WHERE tbl = ?', tbl);
      const upsert = this.db.prepareSync('INSERT OR REPLACE INTO rows (tbl, key, json) VALUES (?, ?, ?)');
      const remove = this.db.prepareSync('DELETE FROM rows WHERE tbl = ? AND key = ?');
      try {
        for (const op of ops) {
          if (op.json === null) remove.executeSync(op.tbl, op.key);
          else upsert.executeSync(op.tbl, op.key, op.json);
        }
      } finally {
        upsert.finalizeSync();
        remove.finalizeSync();
      }
    });
  }

  async writeAsync(clear: readonly string[], ops: readonly RowOp[]): Promise<void> {
    // Exclusive transactions are not supported on web, where the database has
    // a single connection anyway.
    if (Platform.OS === 'web') {
      await this.db.withTransactionAsync(() => this.applyAsync(this.db, clear, ops));
      return;
    }
    await this.db.withExclusiveTransactionAsync((txn) => this.applyAsync(txn, clear, ops));
  }

  private async applyAsync(db: SQLiteDatabase, clear: readonly string[], ops: readonly RowOp[]): Promise<void> {
    for (const tbl of clear) await db.runAsync('DELETE FROM rows WHERE tbl = ?', tbl);
    const upsert = await db.prepareAsync('INSERT OR REPLACE INTO rows (tbl, key, json) VALUES (?, ?, ?)');
    const remove = await db.prepareAsync('DELETE FROM rows WHERE tbl = ? AND key = ?');
    try {
      for (const op of ops) {
        if (op.json === null) await remove.executeAsync(op.tbl, op.key);
        else await upsert.executeAsync(op.tbl, op.key, op.json);
      }
    } finally {
      await upsert.finalizeAsync();
      await remove.finalizeAsync();
    }
  }
}

// Installs that persisted before the per-collection split hold a single
// `food-app-local` row. Split it into per-collection kv rows once, so the
// row-table import below has one layout to read.
splitLegacyBlob(Storage as KvStorage);

const plugin = new RowPersistPlugin(new SqliteRowStore(openDatabaseSync(DB_NAME)), {
  legacy: Storage as KvStorage,
  onError: (error) => console.error('[store] persist failed', error),
});

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

// Land whatever is pending before the OS can suspend or kill the process.
AppState.addEventListener('change', (state) => {
  if (state !== 'active') plugin.flushNow();
});

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

/** Wait for every queued write to land (sign-out, tests). */
export function flushPersistence(): Promise<void> {
  return plugin.flush();
}
