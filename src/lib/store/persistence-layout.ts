/**
 * Layout of the persisted store in the kv-store, plus the one-time upgrade
 * from the pre-split single-row layout. Pure (storage passed in) so it is unit
 * tested without sqlite.
 */

/** Prefix shared by every persisted row; `<prefix>.<collection>`. */
export const PERSIST_PREFIX = 'food-app-local';

/** Legacy single-blob row name (the whole store under one key). */
export const LEGACY_PERSIST_NAME = PERSIST_PREFIX;

/** Top-level store keys, each persisted as its own row. */
export const PERSISTED_KEYS = [
  'settings',
  'meta',
  'households',
  'ingredients',
  'dinners',
  'dinnerItems',
  'dinnerPlans',
  'planEntries',
  'shoppingLists',
  'shoppingListItems',
] as const;

export type PersistedKey = (typeof PERSISTED_KEYS)[number];

/** The subset of `expo-sqlite/kv-store` this module needs (synchronous). */
export type KvStorage = {
  getItemSync(key: string): string | null;
  setItemSync(key: string, value: string): void;
  removeItemSync(key: string): boolean;
};

/** Suffix the Legend-State persist plugin uses for its per-table metadata row. */
const METADATA_SUFFIX = '__m';

/**
 * Split a legacy whole-store row into per-collection rows. Idempotent and safe:
 *  - no legacy row → nothing to do;
 *  - per-collection rows already present → the legacy row is stale; drop it;
 *  - unparseable legacy row → left in place, untouched, so nothing is lost.
 * Returns true when a split was performed.
 */
export function splitLegacyBlob(storage: KvStorage): boolean {
  const raw = storage.getItemSync(LEGACY_PERSIST_NAME);
  if (raw == null) return false;

  const alreadySplit = storage.getItemSync(`${PERSIST_PREFIX}.meta`) != null;
  if (alreadySplit) {
    storage.removeItemSync(LEGACY_PERSIST_NAME);
    storage.removeItemSync(LEGACY_PERSIST_NAME + METADATA_SUFFIX);
    return false;
  }

  let blob: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    blob = parsed as Record<string, unknown>;
  } catch {
    return false;
  }

  for (const key of PERSISTED_KEYS) {
    const slice = blob[key];
    if (slice === undefined || slice === null) continue;
    storage.setItemSync(`${PERSIST_PREFIX}.${key}`, JSON.stringify(slice));
  }
  storage.removeItemSync(LEGACY_PERSIST_NAME);
  storage.removeItemSync(LEGACY_PERSIST_NAME + METADATA_SUFFIX);
  return true;
}
