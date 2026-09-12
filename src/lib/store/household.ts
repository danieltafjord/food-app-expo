import { useValue } from '@legendapp/state/react';

import { store$ } from './collections';
import { newId, nowIso } from './ids';
import type { LocalHousehold } from './schema';

/**
 * Sentinel name stored on the implicit on-device household. It is a stable
 * identifier, not display text: screens show `t('household.localDefaultName')`
 * while the stored name equals this constant, and the user's own name once they
 * rename it.
 */
export const LOCAL_HOUSEHOLD_NAME = 'My Kitchen';

/**
 * Fallback servings for a household that hasn't set its own. Mirrors the
 * backend `households.default_servings` column default so offline and signed-in
 * devices seed new dinners identically.
 */
export const DEFAULT_HOUSEHOLD_SERVINGS = 2;

/**
 * Create the implicit on-device household once, on first launch. Idempotent:
 * if one already exists (restored from persistence) it is left untouched, but a
 * household persisted before `default_servings` existed is backfilled so the
 * stored value is always explicit. Returns the local household id either way.
 */
export function ensureLocalHousehold(): string {
  const existing = store$.meta.localHouseholdId.get();
  if (existing && store$.households[existing].get()) {
    if (store$.households[existing].default_servings.get() == null) {
      store$.households[existing].default_servings.set(DEFAULT_HOUSEHOLD_SERVINGS);
    }
    return existing;
  }
  const id = newId();
  const ts = nowIso();
  store$.households[id].set({
    id,
    name: LOCAL_HOUSEHOLD_NAME,
    default_servings: DEFAULT_HOUSEHOLD_SERVINGS,
    created_at: ts,
    updated_at: ts,
  });
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

/** Reactive read of the household's default servings, with a sane fallback. */
export function useHouseholdDefaultServings(): number {
  return useValue(() => {
    const id = store$.meta.localHouseholdId.get();
    const value = id ? store$.households[id].default_servings.get() : undefined;
    return value ?? DEFAULT_HOUSEHOLD_SERVINGS;
  });
}

/** Non-reactive read (e.g. seeding a new dinner outside React). */
export function getHouseholdDefaultServings(): number {
  const id = store$.meta.localHouseholdId.get();
  const value = id ? store$.households[id].default_servings.get() : undefined;
  return value ?? DEFAULT_HOUSEHOLD_SERVINGS;
}

/** Set the household's default servings (used by the Settings screen). */
export function setHouseholdDefaultServings(servings: number): void {
  const id = store$.meta.localHouseholdId.get();
  if (!id) return;
  store$.households[id].default_servings.set(servings);
  store$.households[id].updated_at.set(nowIso());
}

/**
 * Adopt the active household's default servings from the server (called once
 * `/me` loads, and after a settings PATCH) so a signed-in device matches the
 * household everyone shares. Invalid values are ignored, keeping the local one.
 */
export function applyServerHouseholdSettings(defaultServings: unknown): void {
  if (typeof defaultServings === 'number' && Number.isFinite(defaultServings) && defaultServings >= 1) {
    setHouseholdDefaultServings(Math.round(defaultServings));
  }
}
