import {
  accountTransitionFor,
  bindAccount,
  getBoundAccountId,
  resetLocalDataForAccount,
} from '@/lib/store/account';
import { store$ } from '@/lib/store/collections';

function seedLocalData() {
  store$.dinners.set({
    d1: {
      id: 'd1',
      household_id: 'h',
      name: 'Tacos',
      default_servings: 2,
      notes: null,
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
});

describe('account binding', () => {
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
    expect(store$.shoppingLists.get()).toEqual({});
    expect(store$.meta.dirty.get()).toEqual({});
    expect(store$.meta.tombstones.get()).toEqual({});
    expect(store$.meta.cursor.get()).toBeNull();

    // A fresh local household is seeded so the app still has somewhere to write.
    const localId = store$.meta.localHouseholdId.get();
    expect(localId).toBeTruthy();
    expect(store$.households.get()[localId]).toBeDefined();
  });
});
