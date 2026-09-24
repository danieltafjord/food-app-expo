/**
 * Local-first entity shapes for the on-device store.
 *
 * One type per backend table, kept in `snake_case` to mirror the Laravel
 * schema so the future cloud-sync layer (Phase 2) is a thin mapping rather
 * than a transform. Every entity carries:
 *   - a client-generated UUID `id` (so offline creates have a stable identity),
 *   - a `household_id` scoping it to the local household, and
 *   - `created_at` / `updated_at` ISO strings used by Phase-2 sync.
 *
 * Derived display values (e.g. a dinner's name on a plan entry, an
 * ingredient's name on a shopping item) are intentionally NOT stored here —
 * they are joined at read time from their owning collection, which mirrors
 * the server DTOs and avoids rename staleness.
 */

import type { CategoryId } from '@/lib/categorize';

export type MealType = 'breakfast' | 'lunch' | 'dinner';

export type LocalHousehold = {
  id: string;
  name: string;
  /** Seeds the servings field when a new dinner is created in this household. */
  default_servings: number;
  created_at: string;
  updated_at: string;
};

export type LocalIngredient = {
  id: string;
  household_id: string;
  name: string;
  default_unit: string | null;
  category: string | null;
  category_source?: 'user' | 'dictionary' | 'ai' | null;
  created_at: string;
  updated_at: string;
};

export type LocalDinnerCategory = {
  id: string;
  household_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type LocalDinner = {
  id: string;
  household_id: string;
  name: string;
  default_servings: number;
  notes: string | null;
  category: string | null;
  /**
   * The dinner's picture: an emoji, or an uploaded/generated image stored on
   * the server as square WebP variants under `image_path` (see
   * `@/lib/dinner-images`). Choosing one clears the other.
   */
  emoji: string | null;
  image_path: string | null;
  /** Tiny blurred preview shown while the image loads. */
  image_thumbhash: string | null;
  created_at: string;
  updated_at: string;
};

export type LocalDinnerItem = {
  id: string;
  dinner_id: string;
  ingredient_id: string;
  quantity: number | null;
  unit: string | null;
  created_at: string;
  updated_at: string;
};

export type LocalDinnerPlan = {
  id: string;
  household_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
};

export type LocalPlanEntry = {
  id: string;
  dinner_plan_id: string;
  dinner_id: string;
  scheduled_date: string;
  servings: number;
  meal_type: MealType;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type LocalShoppingList = {
  id: string;
  household_id: string;
  dinner_plan_id: string | null;
  name: string;
  /** Set while the list is archived (its items then live in the archive table). */
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type LocalShoppingListItem = {
  id: string;
  shopping_list_id: string;
  /** An item must carry EITHER `ingredient_id` OR a free-text `name`. */
  ingredient_id: string | null;
  name: string | null;
  quantity: number | null;
  unit: string | null;
  is_checked: boolean;
  /** Only generated, unpurchased rows may be replaced when the plan changes. */
  is_generated?: boolean;
  created_at: string;
  updated_at: string;
};

/* ---- Read models (entity + JS-joined display fields) ------------------- */

export type DinnerWithItems = LocalDinner & { items: LocalDinnerItem[] };

export type PlanEntryWithDinner = LocalPlanEntry & {
  dinner_name: string | null;
  dinner_category: string | null;
  /** How many ingredients the dinner has — 0 means it adds nothing to a shopping list. */
  ingredient_count: number;
};

export type ShoppingListItemWithIngredient = LocalShoppingListItem & {
  ingredient_name: string | null;
  /** Resolved aisle for grouping — from the ingredient, the name, or `other`. */
  category: CategoryId;
};
