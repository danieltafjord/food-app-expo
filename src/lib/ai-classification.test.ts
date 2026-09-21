import { ApiError } from '@/lib/api/client';
import { aiRetryDelay, classifyIngredient, needsClassification } from '@/lib/ai-classification';
import { store$ } from '@/lib/store/collections';
import { createIngredient, setIngredientCategory } from '@/lib/store/ingredients';
import type { LocalIngredient } from '@/lib/store/schema';
import type { SyncRequest } from '@/lib/sync/auth-bridge';

beforeEach(() => {
  store$.ingredients.set({});
  store$.households.set({});
  store$.meta.localHouseholdId.set('household');
  store$.meta.accountId.set(1);
});

function unknownIngredient(): LocalIngredient {
  const id = createIngredient({ name: 'Unfamiliar product xyz' });
  return { ...store$.ingredients[id].get() };
}

it('requests classification only for unknown names without a manual choice', () => {
  const ingredient = unknownIngredient();
  expect(needsClassification(ingredient)).toBe(true);
  expect(needsClassification({ ...ingredient, name: 'Melk' })).toBe(false);
  expect(needsClassification({ ...ingredient, category: 'pantry' })).toBe(false);
  expect(needsClassification({ ...ingredient, category_source: 'user' })).toBe(false);
  expect(needsClassification({ ...ingredient, name: 'x'.repeat(121) })).toBe(false);
});

it('calls our authenticated server and applies a category to the unchanged ingredient', async () => {
  const ingredient = unknownIngredient();
  const request = jest.fn().mockResolvedValue({ category: 'pantry' });

  await classifyIngredient(ingredient, request as SyncRequest, 'nb', new AbortController().signal, () => true);

  expect(request).toHaveBeenCalledWith('/ai/categorize', expect.objectContaining({
    method: 'POST', body: { name: ingredient.name, locale: 'nb' },
  }));
  expect(store$.ingredients[ingredient.id].get()).toMatchObject({ category: 'pantry', category_source: 'ai' });
});

it.each(['unknown', null, '<script>'])('rejects an invalid or uncertain category %s', async (category) => {
  const ingredient = unknownIngredient();
  const request = jest.fn().mockResolvedValue({ category });
  await classifyIngredient(ingredient, request as SyncRequest, 'en', new AbortController().signal, () => true);
  expect(store$.ingredients[ingredient.id].category.get()).toBeNull();
});

it.each(['manual', 'clear', 'rename', 'delete', 'account', 'household', 'disabled', 'abort'])
('discards an in-flight result after %s', async (change) => {
  const ingredient = unknownIngredient();
  let resolve!: (value: unknown) => void;
  const request = jest.fn(() => new Promise((done) => { resolve = done; }));
  const abort = new AbortController();
  let enabled = true;
  const pending = classifyIngredient(ingredient, request as SyncRequest, 'en', abort.signal, () => enabled);
  switch (change) {
    case 'manual': setIngredientCategory(ingredient.id, 'frozen'); break;
    case 'clear': setIngredientCategory(ingredient.id, null); break;
    case 'rename': store$.ingredients[ingredient.id].name.set('Different item'); break;
    case 'delete': store$.ingredients[ingredient.id].delete(); break;
    case 'account': store$.meta.accountId.set(2); break;
    case 'household': store$.meta.localHouseholdId.set('other'); break;
    case 'disabled': enabled = false; break;
    case 'abort': abort.abort(); break;
  }
  resolve({ category: 'pantry' });
  await pending;
  expect(store$.ingredients[ingredient.id].get()?.category).not.toBe('pantry');
});

it('keeps explicit manual clearing out of future classification attempts', () => {
  const ingredient = unknownIngredient();
  setIngredientCategory(ingredient.id, null);
  expect(needsClassification(store$.ingredients[ingredient.id].get())).toBe(false);
});

it('backs off until UTC midnight after daily quota exhaustion', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-21T23:30:00Z'));
  expect(aiRetryDelay(new ApiError(429, '', undefined, { code: 'daily_limit' }))).toBe(30 * 60_000);
  expect(aiRetryDelay(new ApiError(429, ''))).toBe(60_000);
  expect(aiRetryDelay(new Error('Offline'))).toBe(5 * 60_000);
  jest.useRealTimers();
});
