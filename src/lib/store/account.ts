import { batch } from '@legendapp/state';

import { store$ } from './collections';
import { ensureLocalHousehold } from './household';

/**
 * Account binding for the local-first store.
 *
 * The on-device data is usable with no account at all, but the moment it syncs it
 * belongs to exactly one server account. We remember which one in
 * `store$.meta.accountId` so that signing into a *different* account can't quietly
 * upload one account's dinners/plans/lists into another. Switching accounts wipes
 * the local copy instead — the data is untouched on the server under the previous
 * account and returns if the user signs back into it.
 *
 * The sign-in screen drives this: it reconciles before committing the session, so
 * the wipe (and its confirmation) happens *before* the sync engine can seed the
 * outbox. See `src/app/sign-in.tsx`.
 */

/** Whether signing in as a given account claims, resumes, or switches the data. */
export type AccountTransition = 'claim' | 'resume' | 'switch';

/** The server user id the local data is currently bound to, or null if unclaimed. */
export function getBoundAccountId(): number | null {
  return store$.meta.accountId.get() ?? null;
}

/**
 * Classify what signing in as `accountId` means for the local data:
 *  - `claim`  — not bound to any account yet; this account adopts the local data.
 *  - `resume` — already bound to this same account; carry on.
 *  - `switch` — bound to a *different* account; the local data must be cleared
 *               (it stays on the server under the other account) before binding.
 */
export function accountTransitionFor(accountId: number): AccountTransition {
  const bound = getBoundAccountId();
  if (bound == null) {
    return 'claim';
  }
  return bound === accountId ? 'resume' : 'switch';
}

/** Bind the local data to `accountId` without touching it (claim / resume). */
export function bindAccount(accountId: number): void {
  store$.meta.accountId.set(accountId);
}

/**
 * Rebind the device to a different account: wipe every local entity and the sync
 * outbox, reset the sync cursor, seed a fresh local household, and bind to the new
 * account. The wiped data is NOT lost — it was already synced under the previous
 * account and reappears if the user signs back into it.
 */
export function resetLocalDataForAccount(accountId: number): void {
  batch(() => {
    store$.households.set({});
    store$.ingredients.set({});
    store$.dinners.set({});
    store$.dinnerItems.set({});
    store$.dinnerPlans.set({});
    store$.planEntries.set({});
    store$.shoppingLists.set({});
    store$.shoppingListItems.set({});

    store$.meta.dirty.set({});
    store$.meta.tombstones.set({});
    store$.meta.lastSync.set(null);
    store$.meta.localHouseholdId.set('');
    store$.meta.accountId.set(accountId);
  });
  // Recreate the implicit on-device household so the app always has somewhere to write.
  ensureLocalHousehold();
}
