import { apiRequest, ApiError } from '@/lib/api/client';
import { requestAi } from '@/lib/ai-request';
import type { Locale } from '@/lib/i18n/locale';
import { hasExcludedIngredient } from '@/lib/ingredient-exclusions';

/** In the order the planner shows them; the server knows the same set. */
export const PLANNING_SHORTCUTS = [
  'quick', 'budget', 'kids', 'traditional', 'fish', 'vegetarian', 'healthy', 'low_carb', 'one_pot', 'weekend',
] as const;
export type PlanningShortcut = (typeof PLANNING_SHORTCUTS)[number];
/** Choosing one of these drops the other: a vegetarian week can't be fish-heavy. */
export const CONFLICTING_SHORTCUTS: Partial<Record<PlanningShortcut, PlanningShortcut>> = { vegetarian: 'fish', fish: 'vegetarian' };
/** The wishes the household's own dinners can honour: of those, only the category is known. */
export const SAVED_SHORTCUTS: readonly PlanningShortcut[] = ['vegetarian'];
/**
 * Where suggestions come from: the household's own dinners, new recipes, or
 * both. In the order the planner shows them, from familiar to new.
 */
export const PLANNING_SOURCES = ['saved', 'mix', 'new'] as const;
export type PlanningSource = (typeof PLANNING_SOURCES)[number];
export type PlanningPreferences = {
  text: string;
  shortcuts: PlanningShortcut[];
  excluded: string[];
  /** Older versions remembered servings here; planning now starts from the household default. */
  servings?: number;
  /** Missing means `mix`. */
  source?: PlanningSource;
};
/** The most free text a request carries; a day's own wish shares the room with the week's. */
export const PREFERENCES_MAX = 600;
export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export type SuggestedIngredient = { name: string; quantity: number; unit: string | null };
export type SuggestedDinner = {
  existingId: string | null;
  name: string;
  category: string | null;
  notes: string | null;
  baseServings: number;
  ingredients: SuggestedIngredient[];
};
export type WeekSuggestionInput = {
  count: number;
  servings: number;
  locale: Locale;
  preferences: string;
  shortcuts: PlanningShortcut[];
  exclude: string[];
  excluded_ingredients?: string[];
  reuse_ingredients?: string[];
  available: { id: string; name: string; category: string | null; ingredients: string[] }[];
  /** The weekday of each requested dinner, in order. */
  days?: Weekday[];
  /** How many of the dinners to take from `available`. */
  reuse?: number;
};

export const mealNameKey = (name: string) => name.trim().normalize('NFKC').toLowerCase();
const UNITS = new Set(['g', 'kg', 'ml', 'dl', 'l', 'stk', 'ss', 'ts', 'pk', 'boks', 'fedd', 'skive', 'bunt', 'klype']);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string'
  && value.trim().length > 0 && value.length <= max && !/[<>]/.test(value);

/** Validate the network boundary before a preview can reach the local store. */
export function parseWeekSuggestions(value: unknown, input: WeekSuggestionInput, available: SuggestedDinner[]): SuggestedDinner[] {
  const invalid = () => new ApiError(502, 'Invalid dinner suggestions');
  if (!record(value) || !Array.isArray(value.dinners) || value.dinners.length !== input.count) throw invalid();
  const seen = new Set(input.exclude.map(mealNameKey));
  return value.dinners.map((row: unknown) => {
    if (!record(row) || !text(row.name, 120)) throw invalid();
    let dinner: SuggestedDinner;
    if (typeof row.existing_id === 'string') {
      const existing = available.find((item) => item.existingId === row.existing_id);
      if (!existing || !input.available.some((item) => item.id === row.existing_id)) throw invalid();
      dinner = existing;
    } else {
      if (row.existing_id !== null || !['meat', 'fish', 'vegetarian', 'other'].includes(String(row.category))
        || !text(row.notes, 2000) || !Array.isArray(row.ingredients) || !row.ingredients.length || row.ingredients.length > 20) throw invalid();
      const ingredientKeys = new Set<string>();
      const ingredients = row.ingredients.map((item: unknown) => {
        if (!record(item) || !text(item.name, 120) || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)
          || item.quantity <= 0 || item.quantity > 999999.99 || typeof item.unit !== 'string' || !UNITS.has(item.unit)) throw invalid();
        const key = mealNameKey(item.name);
        if (ingredientKeys.has(key)) throw invalid();
        ingredientKeys.add(key);
        return { name: item.name.trim(), quantity: item.quantity, unit: item.unit };
      });
      dinner = { existingId: null, name: row.name.trim(), category: String(row.category), notes: row.notes,
        baseServings: input.servings, ingredients };
    }
    const key = mealNameKey(dinner.name);
    if (hasExcludedIngredient(dinner.ingredients.map((item) => item.name), input.excluded_ingredients ?? [])) throw invalid();
    if (seen.has(key)) throw invalid();
    seen.add(key);
    return dinner;
  });
}

export async function requestWeekSuggestions(input: WeekSuggestionInput, available: SuggestedDinner[], signal: AbortSignal) {
  const result = await requestAi<unknown>(apiRequest, '/ai/plan-week', { method: 'POST', body: input, signal }, 85_000);
  return parseWeekSuggestions(result, input, available);
}
