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
 * Wipe every local entity and the sync outbox, reset the cursor, and seed a
 * fresh local household. The wiped data is NOT lost — it was already synced to
 * the server and comes back on the next pull for whichever household/account the
 * device is bound to afterwards.
 */
function wipeLocalData(): void {
  batch(() => {
    store$.households.set({});
    store$.ingredients.set({});
    store$.dinners.set({});
    store$.dinnerItems.set({});
    store$.dinnerPlans.set({});
    store$.planEntries.set({});
    store$.shoppingLists.set({});
    store$.shoppingListItems.set({});

    store$.meta.aiDismissedSuggestions.set({});
    store$.meta.dirty.set({});
    store$.meta.tombstones.set({});
    store$.meta.cursor.set(null);
    store$.meta.serverHouseholdId.set(null);
    store$.meta.localHouseholdId.set('');
  });
  // Recreate the implicit on-device household so the app always has somewhere to write.
  ensureLocalHousehold();
}

/**
 * Rebind the device to a different account: wipe the local copy and bind to the
 * new account. The data reappears if the user signs back into the previous one.
 */
export function resetLocalDataForAccount(accountId: number): void {
  wipeLocalData();
  store$.meta.accountId.set(accountId);
}

/** Explicit device reset. The caller must disconnect cloud sync first. */
export function clearLocalData(): void {
  wipeLocalData();
  store$.meta.accountId.set(null);
}

/**
 * Rebind the device to a different server household of the same account (the
 * user switched, created, or joined one). The previous household's rows stay on
 * the server; the local copy is wiped and the new household is pulled fresh.
 */
export function resetLocalDataForHousehold(householdId: number): void {
  wipeLocalData();
  store$.meta.serverHouseholdId.set(householdId);
}
