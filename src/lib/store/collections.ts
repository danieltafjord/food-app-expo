import { observable } from '@legendapp/state';

import type { Locale } from '@/lib/i18n/locale';

import type {
  LocalDinner,
  LocalDinnerItem,
  LocalDinnerPlan,
  LocalHousehold,
  LocalIngredient,
  LocalPlanEntry,
  LocalShoppingList,
  LocalShoppingListItem,
} from './schema';
import type { ThemePreference } from './settings';

/**
 * The single source of truth for all on-device data.
 *
 * Each domain is an id-keyed map (`Record<uuid, Entity>`) — one map per
 * backend table — and screens read slices of it through `useValue` (the only
 * React-Compiler-safe reader; never `observer` / `use$`). Cross-entity
 * "joins" (a dinner's items, an entry's dinner name) are done in JS over these
 * maps rather than stored, matching the server DTOs.
 *
 * `meta.localHouseholdId` is the id of the implicit on-device household that
 * scopes everything; it is seeded once on first launch (see `household.ts`).
 */
export const store$ = observable({
  /**
   * User-facing app preferences (theme + language). Local-first so they work
   * offline / without an account; mirrored to the backend user when signed in
   * (see `@/lib/store/settings` + `@/lib/api/settings`). `locale` is seeded from
   * the device language on first launch (`''` means "not seeded yet").
   */
  settings: {
    theme: 'system' as ThemePreference,
    locale: '' as Locale | '',
  },
  meta: {
    localHouseholdId: '' as string,
    /**
     * Cloud-sync bookkeeping (Phase 2). All persisted with the store, so the
     * outbox survives restarts. Keyed by client collection name
     * (`dinnerItems`, `planEntries`, …).
     */
    /** Opaque `server_time` cursor from the last successful sync; null = never synced. */
    lastSync: null as string | null,
    /** Rows with local edits not yet acknowledged by the server: collection → uuid. */
    dirty: {} as Record<string, Record<string, true>>,
    /** Deleted rows awaiting a tombstone push: collection → uuid → deleted_at ISO. */
    tombstones: {} as Record<string, Record<string, string>>,
  },
  households: {} as Record<string, LocalHousehold>,
  ingredients: {} as Record<string, LocalIngredient>,
  dinners: {} as Record<string, LocalDinner>,
  dinnerItems: {} as Record<string, LocalDinnerItem>,
  dinnerPlans: {} as Record<string, LocalDinnerPlan>,
  planEntries: {} as Record<string, LocalPlanEntry>,
  shoppingLists: {} as Record<string, LocalShoppingList>,
  shoppingListItems: {} as Record<string, LocalShoppingListItem>,
});
