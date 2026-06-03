import { useValue } from '@legendapp/state/react';

import { store$ } from './collections';
import { newId, nowIso } from './ids';
import type { LocalHousehold } from './schema';

/** Default name for the implicit on-device household. */
export const LOCAL_HOUSEHOLD_NAME = 'My Kitchen';

/**
 * Create the implicit on-device household once, on first launch. Idempotent:
 * if one already exists (restored from persistence) it is left untouched.
 * Returns the local household id either way.
 */
export function ensureLocalHousehold(): string {
  const existing = store$.meta.localHouseholdId.get();
  if (existing && store$.households[existing].get()) {
    return existing;
  }
  const id = newId();
  const ts = nowIso();
  store$.households[id].set({ id, name: LOCAL_HOUSEHOLD_NAME, created_at: ts, updated_at: ts });
  store$.meta.localHouseholdId.set(id);
  return id;
}

/** Non-reactive accessor used by mutations to stamp `household_id`. */
export function getLocalHouseholdId(): string {
  return store$.meta.localHouseholdId.get();
}

/** Reactive read of the local household (undefined until seeded). */
export function useLocalHousehold(): LocalHousehold | undefined {
  return useValue(() => {
    const id = store$.meta.localHouseholdId.get();
    return id ? store$.households.get()[id] : undefined;
  });
}

/** Rename the local household (used by the Settings screen). */
export function renameLocalHousehold(name: string): void {
  const id = store$.meta.localHouseholdId.get();
  if (!id) return;
  store$.households[id].name.set(name);
  store$.households[id].updated_at.set(nowIso());
}
