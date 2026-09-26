import { observable } from '@legendapp/state';

import type { Locale } from '@/lib/i18n/locale';
import type { ClassificationJob } from '@/lib/ai-classification';
import type { PendingImage } from '@/lib/dinner-images';
import { DEFAULT_REMINDERS, type ReminderSettings } from '@/lib/notifications/reminder-settings';
import type { PlanningPreferences } from '@/lib/week-suggestions';

import type {
  LocalDinner,
  LocalDinnerCategory,
  LocalDinnerItem,
  LocalDinnerPlan,
  LocalHousehold,
  LocalIngredient,
  LocalPlanEntry,
  LocalShoppingList,
  LocalShoppingListItem,
} from './schema';
import type { ShoppingListDensity, ThemePreference } from './settings';

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
    /** Saved on this device; not mirrored to the account or household. */
    shoppingListDensity: 'standard' as ShoppingListDensity,
    aiPaused: {} as Record<string, { categorization: boolean; suggestions: boolean }>,
    locale: '' as Locale | '',
    /** Local reminders on this device (see `@/lib/notifications/reminders`). Stores from older versions lack it. */
    reminders: DEFAULT_REMINDERS as ReminderSettings,
  },
  meta: {
    /** Kept on this device and cleared when switching household/account. */
    planningPreferences: { text: '', shortcuts: [], excluded: [] } as PlanningPreferences,
    /**
     * Dinners the week planner created on this device, with a fingerprint of
     * the recipe it wrote. While a dinner still matches, it's only a suggestion:
     * swapping it out or taking it off the plan deletes it instead of leaving it
     * in the household's recipes. Stores from older versions lack it; Legend
     * reads through the missing map and creates it on the first write.
     */
    suggestedDinners: {} as Record<string, string>,
    /**
     * On-device schema version. Bumped by migrations (see `./migrations`) when
     * the shape in `schema.ts` changes, so persisted rows from an older app
     * version are upgraded on launch instead of hydrating with a stale shape.
     * `0` means "pre-migrations" (or a fresh install before the first run).
     */
    schemaVersion: 0 as number,
    aiDismissedSuggestions: {} as Record<string, string[]>,
    aiClassificationJobs: {} as Record<string, ClassificationJob>,
    /** Photos picked on this device and not uploaded yet: dinner id → local file. */
    pendingImages: {} as Record<string, PendingImage>,
    localHouseholdId: '' as string,
    /**
     * The server user id this device's local data is bound to (`null` until an
     * account first claims it). Signing into a *different* account clears the
     * local data so it never bleeds across accounts — see `@/lib/store/account`.
     */
    accountId: null as number | null,
    /**
     * Whether this device's data is linked to a server household (set when the
     * first sync starts). Until then nothing local exists on the server: the
     * first sync uploads every row anyway, and a delete needs no tombstone, so
     * edits aren't recorded in the outbox at all — for a device that never
     * signs in, that outbox would otherwise grow to every row it ever had.
     */
    linked: false as boolean,
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
  dinnerCategories: {} as Record<string, LocalDinnerCategory>,
  dinners: {} as Record<string, LocalDinner>,
  dinnerItems: {} as Record<string, LocalDinnerItem>,
  dinnerPlans: {} as Record<string, LocalDinnerPlan>,
  planEntries: {} as Record<string, LocalPlanEntry>,
  shoppingLists: {} as Record<string, LocalShoppingList>,
  shoppingListItems: {} as Record<string, LocalShoppingListItem>,
});
