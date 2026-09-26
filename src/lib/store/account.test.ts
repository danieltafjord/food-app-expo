import {
  accountTransitionFor,
  bindAccount,
  clearLocalData,
  getBoundAccountId,
  resetLocalDataForAccount,
} from '@/lib/store/account';
import { archive, MemoryArchive, setArchiveBackend } from '@/lib/store/archive';
import { store$ } from '@/lib/store/collections';

function seedLocalData() {
  store$.dinnerCategories.set({ c1: { id: 'c1', household_id: 'h', name: 'Quick', created_at: 'x', updated_at: 'x' } });
  store$.dinners.set({
    d1: {
      id: 'd1',
      household_id: 'h',
      name: 'Tacos',
      default_servings: 2,
      notes: null,
      category: null,
      emoji: null,
      image_path: null,
      image_thumbhash: null,
      created_at: 'x',
      updated_at: 'x',
    },
  });
  store$.shoppingLists.set({
    l1: {
      id: 'l1',
      household_id: 'h',
      dinner_plan_id: null,
      name: 'Shop',
      created_at: 'x',
      updated_at: 'x',
    },
  });
  store$.meta.dirty.set({ dinners: { d1: true } });
  store$.meta.tombstones.set({ shoppingLists: { gone: '2020-01-01T00:00:00.000Z' } });
  store$.meta.cursor.set(42);
}

beforeEach(() => {
  store$.dinners.set({});
  store$.shoppingLists.set({});
  store$.households.set({});
  store$.meta.dirty.set({});
  store$.meta.tombstones.set({});
  store$.meta.cursor.set(null);
  store$.meta.localHouseholdId.set('');
  store$.meta.accountId.set(null);
  setArchiveBackend(new MemoryArchive(), async () => undefined);
});

describe('account binding', () => {
  it('clears device data and its account binding on an explicit reset', () => {
    bindAccount(1);
    seedLocalData();
    clearLocalData();
    expect(getBoundAccountId()).toBeNull();
    expect(store$.dinners.get()).toEqual({});
    expect(store$.dinnerCategories.get()).toEqual({});
    expect(store$.shoppingLists.get()).toEqual({});
    expect(store$.meta.cursor.get()).toBeNull();
    expect(store$.meta.serverHouseholdId.get()).toBeNull();
    expect(store$.meta.dirty.get()).toEqual({});
    expect(store$.meta.tombstones.get()).toEqual({});
  });
  it('claims unbound local data for the first account', () => {
    expect(getBoundAccountId()).toBeNull();
    expect(accountTransitionFor(1)).toBe('claim');
  });

  it('resumes when signing into the same account', () => {
    bindAccount(1);
    expect(getBoundAccountId()).toBe(1);
    expect(accountTransitionFor(1)).toBe('resume');
  });

  it('detects a switch to a different account', () => {
    bindAccount(1);
    expect(accountTransitionFor(2)).toBe('switch');
  });

  it('wipes local data, resets the sync state, and rebinds on switch', () => {
    bindAccount(1);
    seedLocalData();

    resetLocalDataForAccount(2);

    expect(getBoundAccountId()).toBe(2);
    expect(store$.dinners.get()).toEqual({});
    expect(store$.dinnerCategories.get()).toEqual({});
    expect(store$.shoppingLists.get()).toEqual({});
    expect(store$.meta.dirty.get()).toEqual({});
    expect(store$.meta.tombstones.get()).toEqual({});
    expect(store$.meta.cursor.get()).toBeNull();

    // A fresh local household is seeded so the app still has somewhere to write.
    const localId = store$.meta.localHouseholdId.get();
    expect(localId).toBeTruthy();
    expect(store$.households.get()[localId]).toBeDefined();
  });

  it('forgets archived lists\' items and the first-sync seed with the rest of the data', () => {
    bindAccount(1);
    seedLocalData();
    store$.meta.seeded.set(true);
    archive().stash('l1', [{ id: 'i1', shopping_list_id: 'l1', ingredient_id: null, name: 'Account A secret',
      quantity: null, unit: null, is_checked: true, created_at: 'x', updated_at: 'x' }]);

    resetLocalDataForAccount(2);

    expect(archive().listIds()).toEqual([]);
    expect(store$.meta.seeded.get()).toBe(false);
  });
});
