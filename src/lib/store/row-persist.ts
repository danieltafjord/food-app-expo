import { applyChanges, type Change } from '@legendapp/state';
import type { ObservablePersistPlugin, PersistMetadata } from '@legendapp/state/sync';

/**
 * Row-level persistence plugin for Legend-State.
 *
 * The stock expo-sqlite plugin re-serialises a whole table and commits it
 * synchronously on every change, so a checkbox tap paid a `JSON.stringify` of
 * every shopping item on the device plus a disk write, inside the tap's frame,
 * growing with lifetime data. This plugin instead:
 *
 *  - stores ONE ROW PER TOP-LEVEL KEY of each persisted table (`tbl`, `key`,
 *    `json`) — a shopping item, a dinner, `meta.cursor` — so a change costs a
 *    stringify of that one value;
 *  - coalesces changes with a short trailing timer (bounded by `maxWaitMs`) and
 *    writes them in one asynchronous transaction off the tap frame;
 *  - can be flushed synchronously (`flushNow`) when the app is backgrounded so
 *    nothing is lost if it is killed.
 *
 * Pure: the storage (`RowStore`) is injected so the logic is unit-tested with an
 * in-memory map; `persistence.ts` wires the expo-sqlite implementation.
 */

/** One row write: `json === null` deletes the row. */
export type RowOp = { tbl: string; key: string; json: string | null };

export type RowStore = {
  /** Every persisted row of a table. */
  loadRows(tbl: string): { key: string; json: string }[];
  /** Apply atomically: empty every table in `clear`, then apply `ops` in order. */
  writeSync(clear: readonly string[], ops: readonly RowOp[]): void;
  writeAsync(clear: readonly string[], ops: readonly RowOp[]): Promise<void>;
};

/** A key-value source the pre-row layout persisted whole tables in. */
export type LegacyTableSource = {
  getItemSync(key: string): string | null;
  removeItemSync(key: string): boolean;
};

export type RowPersistOptions = {
  /** Trailing delay before a batch of changes is written. */
  flushDelayMs?: number;
  /** Upper bound on how long continuous edits can postpone a write. */
  maxWaitMs?: number;
  /** Import from the previous whole-table layout on first load. */
  legacy?: LegacyTableSource;
  onError?: (error: unknown) => void;
};

const METADATA_SUFFIX = '__m';
const METADATA_KEY = '__m';

type Table = Record<string, unknown>;

export class RowPersistPlugin implements ObservablePersistPlugin {
  private readonly data: Record<string, Table | undefined> = {};
  /** Tables with unsaved changes: the changed keys, or `null` for "rewrite everything". */
  private readonly dirty = new Map<string, Set<string> | null>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt = 0;
  /** Serialises async writes so batches land in order. */
  private writing: Promise<void> = Promise.resolve();
  private inFlight = 0;

  private readonly flushDelayMs: number;
  private readonly maxWaitMs: number;

  constructor(
    private readonly store: RowStore,
    private readonly options: RowPersistOptions = {},
  ) {
    this.flushDelayMs = options.flushDelayMs ?? 150;
    this.maxWaitMs = options.maxWaitMs ?? 1000;
  }

  /* ---- ObservablePersistPlugin ------------------------------------------ */

  getTable<T = any>(table: string, _init: object): T {
    if (!(table in this.data)) {
      this.data[table] = this.load(table);
    }
    return this.data[table] as T;
  }

  getMetadata(table: string): PersistMetadata {
    const row = this.getTable<Table | undefined>(table + METADATA_SUFFIX, {});
    return (row?.[METADATA_KEY] as PersistMetadata | undefined) ?? {};
  }

  set(table: string, changes: Change[]): void {
    const current = this.data[table] ?? {};
    this.data[table] = applyChanges(current, changes) as Table;
    for (const change of changes) {
      if (change.path.length === 0) {
        this.dirty.set(table, null);
      } else {
        this.markKey(table, String(change.path[0]));
      }
    }
    this.schedule();
  }

  setMetadata(table: string, metadata: PersistMetadata): void {
    const name = table + METADATA_SUFFIX;
    this.data[name] = { [METADATA_KEY]: metadata };
    this.markKey(name, METADATA_KEY);
    this.schedule();
  }

  deleteTable(table: string): void {
    this.data[table] = undefined;
    this.dirty.set(table, null);
    this.schedule();
  }

  deleteMetadata(table: string): void {
    this.deleteTable(table + METADATA_SUFFIX);
  }

  /* ---- flushing --------------------------------------------------------- */

  /** True while a write is queued or in flight. */
  get hasPendingWrites(): boolean {
    return this.dirty.size > 0 || this.inFlight > 0;
  }

  /**
   * Write everything pending. Synchronous when no async write is in flight
   * (the app is about to be backgrounded); otherwise queued behind the
   * in-flight write so batches never land out of order.
   */
  flushNow(): void {
    this.clearTimer();
    const batch = this.collect();
    if (!batch) return;
    if (this.inFlight > 0) {
      this.enqueue(batch);
      return;
    }
    try {
      this.store.writeSync(batch.clear, batch.ops);
    } catch (error) {
      this.requeue(batch);
      this.options.onError?.(error);
    }
  }

  /** Resolves once every write queued so far has landed (tests, sign-out). */
  async flush(): Promise<void> {
    this.clearTimer();
    const batch = this.collect();
    if (batch) this.enqueue(batch);
    await this.writing;
  }

  private schedule(): void {
    const now = Date.now();
    if (this.timer) {
      // Keep coalescing, but never past `maxWaitMs` from the first pending change.
      if (now - this.firstDirtyAt < this.maxWaitMs) return;
      this.clearTimer();
      this.firstDirtyAt = now;
      void this.flush();
      return;
    }
    this.firstDirtyAt = now;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushDelayMs);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private markKey(table: string, key: string): void {
    const keys = this.dirty.get(table);
    if (keys === null) return; // whole table is already being rewritten
    if (keys) keys.add(key);
    else this.dirty.set(table, new Set([key]));
  }

  private collect(): { clear: string[]; ops: RowOp[] } | null {
    if (this.dirty.size === 0) return null;
    const clear: string[] = [];
    const ops: RowOp[] = [];
    for (const [table, keys] of this.dirty) {
      const value = this.data[table];
      if (keys === null) {
        clear.push(table);
        if (value && typeof value === 'object') {
          for (const [key, v] of Object.entries(value)) {
            if (v !== undefined) ops.push({ tbl: table, key, json: JSON.stringify(v) });
          }
        }
        continue;
      }
      for (const key of keys) {
        const v = value?.[key];
        ops.push({ tbl: table, key, json: v === undefined ? null : JSON.stringify(v) });
      }
    }
    this.dirty.clear();
    return { clear, ops };
  }

  private enqueue(batch: { clear: string[]; ops: RowOp[] }): void {
    this.inFlight += 1;
    this.writing = this.writing
      .then(() => this.store.writeAsync(batch.clear, batch.ops))
      .catch((error: unknown) => {
        this.requeue(batch);
        this.options.onError?.(error);
      })
      .finally(() => {
        this.inFlight -= 1;
      });
  }

  /** A failed batch goes back into `dirty` so the next flush retries it. */
  private requeue(batch: { clear: string[]; ops: RowOp[] }): void {
    for (const table of batch.clear) this.dirty.set(table, null);
    for (const op of batch.ops) this.markKey(op.tbl, op.key);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.maxWaitMs);
    }
  }

  /* ---- loading ---------------------------------------------------------- */

  private load(table: string): Table | undefined {
    const rows = this.store.loadRows(table);
    if (rows.length === 0) {
      return this.importLegacy(table);
    }
    const value: Table = {};
    for (const row of rows) {
      try {
        value[row.key] = JSON.parse(row.json);
      } catch {
        // A corrupt row is skipped rather than taking the whole table down.
      }
    }
    return value;
  }

  /**
   * First launch after the upgrade: the table still lives as one JSON blob in
   * the kv-store. Split it into rows (synchronously, so hydration sees it) and
   * drop the blob. An unparseable blob is left in place and the table starts
   * empty, so nothing is destroyed.
   */
  private importLegacy(table: string): Table | undefined {
    const legacy = this.options.legacy;
    if (!legacy) return undefined;
    const raw = legacy.getItemSync(table);
    if (raw == null) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const value = parsed as Table;
    const ops: RowOp[] = [];
    for (const [key, v] of Object.entries(value)) {
      if (v !== undefined) ops.push({ tbl: table, key, json: JSON.stringify(v) });
    }
    this.store.writeSync([table], ops);
    legacy.removeItemSync(table);
    legacy.removeItemSync(table + METADATA_SUFFIX);
    return value;
  }
}

/** In-memory `RowStore` (tests, and a safe fallback). */
export class MemoryRowStore implements RowStore {
  readonly tables = new Map<string, Map<string, string>>();
  writes = 0;

  loadRows(tbl: string): { key: string; json: string }[] {
    const rows = this.tables.get(tbl);
    return rows ? Array.from(rows, ([key, json]) => ({ key, json })) : [];
  }

  writeSync(clear: readonly string[], ops: readonly RowOp[]): void {
    this.writes += 1;
    for (const tbl of clear) this.tables.delete(tbl);
    for (const op of ops) {
      let rows = this.tables.get(op.tbl);
      if (!rows) {
        rows = new Map();
        this.tables.set(op.tbl, rows);
      }
      if (op.json === null) rows.delete(op.key);
      else rows.set(op.key, op.json);
    }
  }

  async writeAsync(clear: readonly string[], ops: readonly RowOp[]): Promise<void> {
    this.writeSync(clear, ops);
  }
}
