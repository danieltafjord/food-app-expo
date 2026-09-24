import { batch } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';

import { DINNER_CATEGORIES, type BuiltinDinnerCategory } from '@/lib/dinner-categories';
import { useT } from '@/lib/i18n';
import { store$ } from './collections';
import { getLocalHouseholdId } from './household';
import { newId, nowIso } from './ids';

export function useDinnerCategories() {
  const rows = useValue(store$.dinnerCategories);
  return Object.values(rows).sort((a, b) => a.name.localeCompare(b.name));
}

export function useDinnerCategoryLabel() {
  const t = useT();
  const rows = useValue(store$.dinnerCategories);
  return (value: string | null | undefined): string => {
    if (value === 'all' || value === 'none') return t(`dinnerCategories.${value}`);
    if (DINNER_CATEGORIES.includes(value as BuiltinDinnerCategory)) return t(`dinnerCategories.${value as BuiltinDinnerCategory}`);
    return (value && rows[value]?.name) || t('dinnerCategories.none');
  };
}

export function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function findDinnerCategory(name: string, exceptId?: string): string | undefined {
  const key = normalizeCategoryName(name).toLocaleLowerCase();
  return Object.values(store$.dinnerCategories.peek()).find((row) => row.id !== exceptId
    && normalizeCategoryName(row.name).toLocaleLowerCase() === key)?.id;
}

export function saveDinnerCategory(name: string, id?: string): string | null {
  const normalized = normalizeCategoryName(name);
  if (!normalized || Array.from(normalized).length > 80) return null;
  const existing = findDinnerCategory(normalized, id);
  if (existing) return id ? null : existing;
  const ts = nowIso();
  if (id) {
    if (!store$.dinnerCategories[id].peek()) return null;
    store$.dinnerCategories[id].assign({ name: normalized, updated_at: ts });
  } else {
    id = newId();
    store$.dinnerCategories[id].set({ id, household_id: getLocalHouseholdId(), name: normalized, created_at: ts, updated_at: ts });
  }
  return id;
}

/** Keep recipes and their ingredients when removing a category. */
export function deleteDinnerCategory(id: string): void {
  batch(() => {
    for (const dinner of Object.values(store$.dinners.peek())) {
      if (dinner.category === id) store$.dinners[dinner.id].assign({ category: null, updated_at: nowIso() });
    }
    store$.dinnerCategories[id].delete();
  });
}
