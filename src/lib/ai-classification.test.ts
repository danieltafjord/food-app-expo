import { ApiError } from '@/lib/api/client';
import { aiRetryDelay, classifyIngredient, needsClassification, classificationReady, runClassificationJob } from '@/lib/ai-classification';
import { store$ } from '@/lib/store/collections';
import { createIngredient, setIngredientCategory } from '@/lib/store/ingredients';
import type { LocalIngredient } from '@/lib/store/schema';
import type { SyncRequest } from '@/lib/sync/auth-bridge';

beforeEach(() => {
  store$.ingredients.set({});
  store$.households.set({});
  store$.meta.localHouseholdId.set('household');
  store$.meta.accountId.set(1);
  store$.meta.aiClassificationJobs.set({});
});

function unknownIngredient(): LocalIngredient {
  const id = createIngredient({ name: 'Unfamiliar product xyz' });
  return store$.ingredients[id].get();
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

it('accepts equivalent timestamp precision after a sync echo', async () => {
  const ingredient = unknownIngredient();
  store$.ingredients[ingredient.id].updated_at.set('2026-09-22T10:00:00.123Z');
  const request = jest.fn(async () => {
    store$.ingredients[ingredient.id].set({ ...ingredient, updated_at: '2026-09-22T10:00:00.123000Z' });
    return { category: 'pantry' };
  });
  await expect(classifyIngredient(ingredient, request as SyncRequest, 'en', new AbortController().signal, () => true)).resolves.toBe('applied');
});

it('retries a stale result for the same name after an unrelated edit', async () => {
  const ingredient = unknownIngredient();
  const request = jest.fn(async () => {
    store$.ingredients[ingredient.id].assign({ default_unit: 'g', updated_at: '2099-01-01T00:00:00Z' });
    return { category: 'pantry' };
  });
  await runClassificationJob(ingredient, request as SyncRequest, 'en', new AbortController().signal, () => true);
  expect(classificationReady(ingredient, 'en')).toBe(true);
  expect(store$.ingredients[ingredient.id].category.get()).toBeNull();
});

it('persists uncertain outcomes and retries them after expiry or an input change', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-22T10:00:00Z'));
  try {
    const ingredient = unknownIngredient();
    await runClassificationJob(ingredient, jest.fn().mockResolvedValue({ category: null }) as SyncRequest, 'en', new AbortController().signal, () => true);
    expect(classificationReady(ingredient, 'en')).toBe(false);
    expect(classificationReady(ingredient, 'nb')).toBe(true);
    jest.advanceTimersByTime(24 * 60 * 60_000);
    expect(classificationReady(ingredient, 'en')).toBe(true);
  } finally { jest.useRealTimers(); }
});

it('backs off one failed item without blocking the next ingredient', async () => {
  const ingredient = unknownIngredient();
  const otherId = createIngredient({ name: 'Another unfamiliar xyz product' });
  const error = new ApiError(503, 'unavailable');
  await expect(runClassificationJob(ingredient, jest.fn().mockRejectedValue(error) as SyncRequest, 'en', new AbortController().signal, () => true)).rejects.toBe(error);
  expect(classificationReady(ingredient, 'en')).toBe(false);
  expect(classificationReady(store$.ingredients[otherId].get(), 'en')).toBe(true);
  expect(aiRetryDelay(new ApiError(429, '', undefined, { code: 'busy' }, 5000))).toBe(5000);
});
