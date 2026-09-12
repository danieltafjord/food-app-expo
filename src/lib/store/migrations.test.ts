import { CURRENT_SCHEMA_VERSION, migrate } from '@/lib/store/migrations';

describe('migrate — v0 → v1 (backfill timestamps)', () => {
  it('backfills missing created_at/updated_at', () => {
    const out = migrate({ dinners: { d1: { id: 'd1', name: 'Taco' } } }, 0) as Record<string, any>;
    expect(typeof out.dinners.d1.created_at).toBe('string');
    expect(out.dinners.d1.updated_at).toBe(out.dinners.d1.created_at);
  });

  it('backfills updated_at from an existing created_at, leaving created_at intact', () => {
    const out = migrate(
      { ingredients: { i1: { id: 'i1', name: 'Onion', created_at: '2026-06-01T00:00:00.000Z' } } },
      0,
    ) as Record<string, any>;
    expect(out.ingredients.i1.created_at).toBe('2026-06-01T00:00:00.000Z');
    expect(out.ingredients.i1.updated_at).toBe('2026-06-01T00:00:00.000Z');
  });

  it('leaves rows that already have both timestamps untouched', () => {
    const row = { id: 'd1', name: 'Taco', created_at: 'A', updated_at: 'B' };
    const out = migrate({ dinners: { d1: { ...row } } }, 0) as Record<string, any>;
    expect(out.dinners.d1).toEqual(row);
  });

  it('walks every entity collection', () => {
    const out = migrate(
      {
        households: { h1: { id: 'h1' } },
        planEntries: { e1: { id: 'e1' } },
        shoppingListItems: { s1: { id: 's1' } },
      },
      0,
    ) as Record<string, any>;
    expect(out.households.h1.created_at).toEqual(expect.any(String));
    expect(out.planEntries.e1.updated_at).toEqual(expect.any(String));
    expect(out.shoppingListItems.s1.created_at).toEqual(expect.any(String));
  });

  it('tolerates missing/empty collections and non-object rows', () => {
    expect(() => migrate({}, 0)).not.toThrow();
    expect(() => migrate({ dinners: {} }, 0)).not.toThrow();
    expect(() => migrate({ dinners: { bad: null } }, 0)).not.toThrow();
  });

  it('replaces the timestamp cursor with the integer cursor and household binding', () => {
    const out = migrate({ meta: { lastSync: 'x', accountId: 3 }, dinners: {} }, 0) as Record<string, any>;
    expect(out.meta).toEqual({ accountId: 3, cursor: null, serverHouseholdId: null });
  });
});

describe('migrate — v1 → v2 (categorize ingredients)', () => {
  it('auto-categorizes a Norwegian ingredient from its name', () => {
    const out = migrate(
      { ingredients: { i1: { id: 'i1', name: 'Kyllingfilet', category: null } } },
      1,
    ) as Record<string, any>;
    expect(out.ingredients.i1.category).toBe('meat');
  });

  it('maps a legacy English category label to a stable id', () => {
    const out = migrate(
      { ingredients: { i1: { id: 'i1', name: 'Whatever', category: 'Produce' } } },
      1,
    ) as Record<string, any>;
    expect(out.ingredients.i1.category).toBe('produce');
  });

  it('keeps an already-valid category id untouched', () => {
    const out = migrate(
      { ingredients: { i1: { id: 'i1', name: 'Melk', category: 'dairy' } } },
      1,
    ) as Record<string, any>;
    expect(out.ingredients.i1.category).toBe('dairy');
  });

  it('leaves an unrecognized item as null', () => {
    const out = migrate(
      { ingredients: { i1: { id: 'i1', name: 'zzxq widget', category: null } } },
      1,
    ) as Record<string, any>;
    expect(out.ingredients.i1.category).toBeNull();
  });

  it('tolerates missing ingredients collection', () => {
    expect(() => migrate({ dinners: {} }, 1)).not.toThrow();
  });
});

describe('migrate — version gating', () => {
  it('is a no-op when already at the current version', () => {
    const out = migrate({ dinners: { d1: { id: 'd1', name: 'Taco' } } }, CURRENT_SCHEMA_VERSION) as Record<
      string,
      any
    >;
    expect(out.dinners.d1.created_at).toBeUndefined();
  });

  it('current version is at least 1 (the timestamp migration exists)', () => {
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });
});
