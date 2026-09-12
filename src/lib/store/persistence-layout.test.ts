import {
  LEGACY_PERSIST_NAME,
  PERSIST_PREFIX,
  splitLegacyBlob,
  type KvStorage,
} from '@/lib/store/persistence-layout';

function memoryStorage(initial: Record<string, string> = {}): KvStorage & { rows: Map<string, string> } {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    getItemSync: (key) => rows.get(key) ?? null,
    setItemSync: (key, value) => void rows.set(key, value),
    removeItemSync: (key) => rows.delete(key),
  };
}

const legacy = {
  settings: { theme: 'dark', locale: 'nb' },
  meta: { schemaVersion: 3, localHouseholdId: 'h1', cursor: 42, dirty: {}, tombstones: {} },
  households: { h1: { id: 'h1', name: 'My Kitchen' } },
  ingredients: { i1: { id: 'i1', name: 'Melk' } },
  dinners: {},
  dinnerItems: {},
  dinnerPlans: {},
  planEntries: {},
  shoppingLists: {},
  shoppingListItems: {},
};

describe('splitLegacyBlob', () => {
  it('does nothing on a fresh install', () => {
    const storage = memoryStorage();
    expect(splitLegacyBlob(storage)).toBe(false);
    expect(storage.rows.size).toBe(0);
  });

  it('splits a legacy blob into one row per collection and removes the blob', () => {
    const storage = memoryStorage({
      [LEGACY_PERSIST_NAME]: JSON.stringify(legacy),
      [`${LEGACY_PERSIST_NAME}__m`]: '{}',
    });
    expect(splitLegacyBlob(storage)).toBe(true);

    expect(storage.getItemSync(LEGACY_PERSIST_NAME)).toBeNull();
    expect(storage.getItemSync(`${LEGACY_PERSIST_NAME}__m`)).toBeNull();
    expect(JSON.parse(storage.getItemSync(`${PERSIST_PREFIX}.meta`)!)).toEqual(legacy.meta);
    expect(JSON.parse(storage.getItemSync(`${PERSIST_PREFIX}.ingredients`)!)).toEqual(legacy.ingredients);
    expect(JSON.parse(storage.getItemSync(`${PERSIST_PREFIX}.settings`)!)).toEqual(legacy.settings);
    expect(JSON.parse(storage.getItemSync(`${PERSIST_PREFIX}.shoppingListItems`)!)).toEqual({});
  });

  it('skips keys the legacy blob does not carry', () => {
    const storage = memoryStorage({
      [LEGACY_PERSIST_NAME]: JSON.stringify({ meta: { schemaVersion: 1 } }),
    });
    expect(splitLegacyBlob(storage)).toBe(true);
    expect(storage.getItemSync(`${PERSIST_PREFIX}.meta`)).toBe('{"schemaVersion":1}');
    expect(storage.getItemSync(`${PERSIST_PREFIX}.dinners`)).toBeNull();
  });

  it('never overwrites already-split rows with a stale blob', () => {
    const storage = memoryStorage({
      [LEGACY_PERSIST_NAME]: JSON.stringify(legacy),
      [`${PERSIST_PREFIX}.meta`]: '{"schemaVersion":3,"cursor":99}',
    });
    expect(splitLegacyBlob(storage)).toBe(false);
    expect(storage.getItemSync(`${PERSIST_PREFIX}.meta`)).toBe('{"schemaVersion":3,"cursor":99}');
    expect(storage.getItemSync(`${PERSIST_PREFIX}.ingredients`)).toBeNull();
    expect(storage.getItemSync(LEGACY_PERSIST_NAME)).toBeNull();
  });

  it('leaves an unparseable blob untouched', () => {
    const storage = memoryStorage({ [LEGACY_PERSIST_NAME]: '{not json' });
    expect(splitLegacyBlob(storage)).toBe(false);
    expect(storage.getItemSync(LEGACY_PERSIST_NAME)).toBe('{not json');
  });
});
