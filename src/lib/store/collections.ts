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
    aiPaused: {} as Record<string, { categorization: boolean; suggestions: boolean }>,
    locale: '' as Locale | '',
  },
  meta: {
    /**
     * On-device schema version. Bumped by migrations (see `./migrations`) when
     * the shape in `schema.ts` changes, so persisted rows from an older app
     * version are upgraded on launch instead of hydrating with a stale shape.
     * `0` means "pre-migrations" (or a fresh install before the first run).
     */
    schemaVersion: 0 as number,
    aiDismissedSuggestions: {} as Record<string, string[]>,
    localHouseholdId: '' as string,
    /**
     * The server user id this device's local data is bound to (`null` until an
     * account first claims it). Signing into a *different* account clears the
     * local data so it never bleeds across accounts — see `@/lib/store/account`.
     */
    accountId: null as number | null,
    /**
     * Cloud-sync bookkeeping (Phase 2). All persisted with the store, so the
     * outbox survives restarts. Keyed by client collection name
     * (`dinnerItems`, `planEntries`, …).
     */
    /**
     * Integer cursor returned by the last successful sync (the household's
     * `sync_version` at that point); null = never synced. Every pull asks for
     * rows above it.
     */
    cursor: null as number | null,
    /**
     * The server household this device's data is bound to (null until the
     * first sync). A sync is refused if the account's active household differs,
     * so one household's rows can never be uploaded into another — the device
     * is re-bound (local copy wiped and re-pulled) instead. See `engine.ts`.
     */
    serverHouseholdId: null as number | null,
    /** Rows with local edits not yet acknowledged by the server: collection → uuid. */
    dirty: {} as Record<string, Record<string, true>>,
    /** Rejected edits retained until corrected or explicitly deleted. */
    failed: {} as Record<string, Record<string, { code: string; message: string }>>,
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
