import { categorize, coerceCategory } from '@/lib/categorize';

import { store$ } from './collections';

/**
 * On-device schema migrations.
 *
 * The persisted store (expo-sqlite kv-store) survives app updates, so any change
 * to the shapes in `schema.ts` must be paired with a migration here — otherwise
 * rows written by an older app version hydrate with a stale shape and readers,
 * which assume their fields are present (sorts, `localeCompare`, joins), crash.
 *
 * `MIGRATIONS[i]` upgrades the plain store snapshot from version `i` to `i + 1`.
 * `migrate()` is pure (snapshot in, snapshot out) so it is unit-tested in
 * isolation; `runMigrations()` is the thin wrapper that reads/writes the live
 * observable, run once during hydration before any screen or the sync engine
 * reads the collections.
 */

type Json = Record<string, unknown>;
type Rows = Record<string, Record<string, unknown>>;
type Migration = (data: Json) => Json;

/** The id-keyed entity maps a migration may need to walk. */
const COLLECTIONS = [
  'households',
  'ingredients',
  'dinners',
  'dinnerItems',
  'dinnerPlans',
  'planEntries',
  'shoppingLists',
  'shoppingListItems',
] as const;

/** Sentinel for rows that predate a column — sorts before any real timestamp. */
const EPOCH = '1970-01-01T00:00:00.000Z';

function eachRow(data: Json, fn: (row: Record<string, unknown>) => void): void {
  for (const collection of COLLECTIONS) {
    const rows = data[collection] as Rows | undefined;
    if (!rows || typeof rows !== 'object') continue;
    for (const row of Object.values(rows)) {
      if (row && typeof row === 'object') fn(row as Record<string, unknown>);
    }
  }
}

/**
 * v0 → v1: backfill `created_at` / `updated_at` on any row missing them.
 *
 * Early dev builds wrote rows before these columns were consistently set, and
 * the store sorts/compares on them in several places (`dinners`, `plans`,
 * `shopping-lists`). A missing timestamp threw on `localeCompare`; this makes
 * every row carry a string timestamp so those reads are crash-proof.
 */
function v0_backfillTimestamps(data: Json): Json {
  eachRow(data, (row) => {
    if (typeof row.created_at !== 'string') row.created_at = EPOCH;
    if (typeof row.updated_at !== 'string') row.updated_at = row.created_at;
  });
  return data;
}

/**
 * v1 → v2: backfill `ingredient.category` with an aisle id.
 *
 * The category field predated the categorizer (rows were null, or carried the
 * backend seeder's English labels like `'Produce'`). This maps any known
 * legacy/valid value to a stable id and auto-categorizes the rest from the
 * name, so existing shopping lists group into aisles immediately. Unknown items
 * stay null (rendered as "Other").
 */
function v1_categorizeIngredients(data: Json): Json {
  const ingredients = data.ingredients as Rows | undefined;
  if (!ingredients || typeof ingredients !== 'object') {
    return data;
  }
  for (const row of Object.values(ingredients)) {
    if (!row || typeof row !== 'object') continue;
    const coerced = coerceCategory(row.category);
    if (coerced) {
      row.category = coerced;
      continue;
    }
    row.category = typeof row.name === 'string' ? categorize(row.name) : null;
  }
  return data;
}

/**
 * v2 → v3: the sync cursor became an integer version (`meta.cursor`) and the
 * device now records which server household it is bound to. The old timestamp
 * cursor is dropped; a null cursor simply re-runs the first sync, which merges
 * by uuid and loses nothing.
 */
function v2_integerCursor(data: Json): Json {
  const meta = (data.meta ?? {}) as Json;
  delete meta.lastSync;
  if (typeof meta.cursor !== 'number') meta.cursor = null;
  if (typeof meta.serverHouseholdId !== 'number') meta.serverHouseholdId = null;
  data.meta = meta;
  return data;
}

function v3_recoverOutbox(data: Json): Json {
  const meta = (data.meta ??= {}) as Json;
  meta.failed ??= {};
  for (const row of Object.values((data.shoppingListItems ?? {}) as Rows)) {
    if (row && typeof row === 'object') row.is_generated ??= false;
  }
  const dirty = (meta.dirty ?? {}) as Record<string, Record<string, unknown>>;
  for (const [collection, ids] of Object.entries(dirty)) {
    for (const id of Object.keys(ids)) {
      if (!(data[collection] as Rows | undefined)?.[id]) delete ids[id];
    }
  }
  return data;
}

/** Ordered migrations. Append a new function to bump the schema version by one. */
const MIGRATIONS: Migration[] = [v0_backfillTimestamps, v1_categorizeIngredients, v2_integerCursor, v3_recoverOutbox];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Apply every migration from `fromVersion` up to the current version, in order.
 * Pure — mutates and returns the passed snapshot, with no observable/store side
 * effects, so it can be tested directly.
 */
export function migrate(data: Json, fromVersion: number): Json {
  let next = data;
  for (let v = Math.max(0, fromVersion); v < MIGRATIONS.length; v += 1) {
    next = MIGRATIONS[v](next);
  }
  return next;
}

/**
 * Run any pending migrations against the live store. Call exactly once, after
 * hydration and before anything reads the collections. No-op (and cheap) once
 * the store is already at the current version.
 */
export function runMigrations(): void {
  const from = store$.meta.schemaVersion.get() ?? 0;
  if (from >= CURRENT_SCHEMA_VERSION) {
    // Stamp the version on fresh installs / replace-merge hydration that lost it.
    if (store$.meta.schemaVersion.get() !== CURRENT_SCHEMA_VERSION) {
      store$.meta.schemaVersion.set(CURRENT_SCHEMA_VERSION);
    }
    return;
  }
  // Clone so the migration mutates a detached snapshot, not live observable data.
  const snapshot = JSON.parse(JSON.stringify(store$.get())) as Json;
  const migrated = migrate(snapshot, from);
  migrated.meta = { ...(migrated.meta as Json), schemaVersion: CURRENT_SCHEMA_VERSION };
  store$.set(migrated as ReturnType<typeof store$.get>);
}
