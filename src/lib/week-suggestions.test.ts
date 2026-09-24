import { parseWeekSuggestions, type SuggestedDinner, type WeekSuggestionInput } from './week-suggestions';

const input: WeekSuggestionInput = { count: 1, servings: 2, locale: 'nb', preferences: '', shortcuts: [], exclude: [], available: [] };
const dinner = { existing_id: null, name: 'Tomatpasta', category: 'vegetarian', notes: 'Kok pastaen.',
  ingredients: [{ name: 'Pasta', quantity: 200, unit: 'g' }] };

it('parses complete recipes for the requested number of portions', () => {
  expect(parseWeekSuggestions({ dinners: [dinner] }, input, [])).toEqual([{ existingId: null,
    name: 'Tomatpasta', category: 'vegetarian', notes: 'Kok pastaen.', baseServings: 2, ingredients: dinner.ingredients }]);
});

it.each([
  {}, { dinners: [] }, { dinners: [{ ...dinner, ingredients: [] }] },
  { dinners: [{ ...dinner, ingredients: [{ name: 'Pasta', quantity: -2, unit: 'g' }] }] },
  { dinners: [{ ...dinner, existing_id: 'unknown' }] }, { dinners: [{ ...dinner, notes: null }] },
  { dinners: [{ ...dinner, ingredients: [dinner.ingredients[0], dinner.ingredients[0]] }] },
  { dinners: [{ ...dinner, ingredients: [dinner.ingredients[0], { name: ' pasta ', quantity: 1, unit: 'kg' }] }] },
])('rejects malformed output before it becomes a preview', (result) => {
  expect(() => parseWeekSuggestions(result, input, [])).toThrow('Invalid dinner suggestions');
});

it('rejects excluded names and duplicates regardless of casing or surrounding spaces', () => {
  expect(() => parseWeekSuggestions({ dinners: [dinner] }, { ...input, exclude: [' tomatpasta '] }, [])).toThrow();
  expect(() => parseWeekSuggestions({ dinners: [dinner, { ...dinner, name: ' TOMATPASTA ' }] }, { ...input, count: 2 }, [])).toThrow();
});

it('uses the reviewed local recipe for an allowed reference, ignoring generated replacements', () => {
  const existing: SuggestedDinner = { existingId: 'local', name: 'My pasta', baseServings: 4, category: null,
    notes: 'My instructions', ingredients: [{ name: 'Pasta', quantity: 400, unit: 'g' }] };
  const request = { ...input, available: [{ id: 'local', name: 'My pasta', category: null, ingredients: ['Pasta'] }] };
  expect(parseWeekSuggestions({ dinners: [{ ...dinner, existing_id: 'local' }] }, request, [existing])).toEqual([existing]);
  expect(() => parseWeekSuggestions({ dinners: [{ ...dinner, existing_id: 'local' }] }, input, [existing])).toThrow();
});
