import { findExact, searchIndex, type Indexed } from '@/lib/search';

/** Stable recipe categories, independent of the ingredient aisle taxonomy. */
export const DINNER_CATEGORIES = ['meat', 'fish', 'vegetarian', 'other'] as const;
export type BuiltinDinnerCategory = (typeof DINNER_CATEGORIES)[number];
export type DinnerCategory = string;
export type DinnerCategoryFilter = DinnerCategory | 'all' | 'none';

export function dinnerCategory(value: unknown): DinnerCategory | null {
  return typeof value === 'string' && (DINNER_CATEGORIES.some((category) => category === value)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) ? value : null;
}

export function matchesDinnerCategory(value: unknown, filter: DinnerCategoryFilter): boolean {
  return filter === 'all' || (filter === 'none' ? dinnerCategory(value) === null : value === filter);
}

/** Exact-name creation guards must see dinners outside the selected category. */
export function searchDinners<T extends { category?: string | null }>(
  index: readonly Indexed<T>[], query: string, filter: DinnerCategoryFilter,
) {
  return {
    results: searchIndex(index, query).filter((dinner) => matchesDinnerCategory(dinner.category, filter)),
    exact: findExact(index, query),
  };
}
