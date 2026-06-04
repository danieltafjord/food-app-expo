/**
 * The fixed grocery-aisle taxonomy used to group shopping-list items.
 *
 * Category **ids are stable** (stored on `ingredient.category`, synced) — never
 * rename one; only its localized label (via i18n `categories.<id>`) changes. The
 * array order *is* the aisle order the list is grouped by, with `other` always
 * last as the catch-all for anything the categorizer can't place.
 *
 * This module is pure data + helpers (no React, no store, no native imports) so
 * it can be imported from the store, the UI, and unit tests alike.
 */

export const CATEGORY_IDS = [
  'produce',
  'dairy',
  'meat',
  'fish',
  'deli',
  'bakery',
  'frozen',
  'pantry',
  'canned',
  'baking',
  'spices',
  'snacks',
  'beverages',
  'household',
  'personal_care',
  'other',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

/** Aisle order the shopping list is grouped by (`other` last). */
export const CATEGORY_ORDER: readonly CategoryId[] = CATEGORY_IDS;

/** A small emoji per aisle — purely decorative section affordance. */
export const CATEGORY_EMOJI: Record<CategoryId, string> = {
  produce: '🥬',
  dairy: '🥛',
  meat: '🥩',
  fish: '🐟',
  deli: '🧀',
  bakery: '🍞',
  frozen: '🧊',
  pantry: '🍝',
  canned: '🥫',
  baking: '🧁',
  spices: '🧂',
  snacks: '🍫',
  beverages: '🧃',
  household: '🧽',
  personal_care: '🧴',
  other: '🛒',
};

const CATEGORY_SET = new Set<string>(CATEGORY_IDS);

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && CATEGORY_SET.has(value);
}

/**
 * Legacy / external category strings → a current id. Covers the English labels
 * the backend seeder and older rows used (`'Produce'`, `'Meat'`, …) so a synced
 * ingredient still lands in the right aisle. Returns null for anything unknown,
 * letting the caller fall back to re-deriving from the name.
 */
const LEGACY_LABELS: Record<string, CategoryId> = {
  produce: 'produce',
  'fruit & vegetables': 'produce',
  'fruit and vegetables': 'produce',
  vegetables: 'produce',
  fruit: 'produce',
  dairy: 'dairy',
  'dairy & eggs': 'dairy',
  eggs: 'dairy',
  meat: 'meat',
  'meat & seafood': 'meat',
  poultry: 'meat',
  fish: 'fish',
  seafood: 'fish',
  deli: 'deli',
  cheese: 'deli',
  bakery: 'bakery',
  bread: 'bakery',
  frozen: 'frozen',
  pantry: 'pantry',
  'dry goods': 'pantry',
  canned: 'canned',
  baking: 'baking',
  spices: 'spices',
  'spices & oils': 'spices',
  condiments: 'canned',
  snacks: 'snacks',
  'snacks & sweets': 'snacks',
  sweets: 'snacks',
  beverages: 'beverages',
  drinks: 'beverages',
  household: 'household',
  cleaning: 'household',
  'personal care': 'personal_care',
  health: 'personal_care',
  other: 'other',
};

/** Coerce an arbitrary stored category value to a known id, or null. */
export function coerceCategory(value: unknown): CategoryId | null {
  if (isCategoryId(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return LEGACY_LABELS[value.trim().toLowerCase()] ?? null;
  }
  return null;
}
