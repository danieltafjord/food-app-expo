import { hasExcludedIngredient, parseIngredientExclusions } from './ingredient-exclusions';

it('parses editable lists while trimming, deduplicating and allowing an explicit clear', () => {
  expect(parseIngredientExclusions(' Sopp, reker\nSOPP, ')).toEqual(['SOPP', 'reker']);
  expect(parseIngredientExclusions(' ,\n ')).toEqual([]);
});

it.each(['x'.repeat(81), '<fish>', Array.from({ length: 31 }, (_, i) => `item${i}`).join(',')])(
  'rejects exclusions the server cannot persist', (text) => expect(() => parseIngredientExclusions(text)).toThrow(),
);

it('matches whole phrases inside product names without matching unrelated words', () => {
  expect(hasExcludedIngredient(['Light soy sauce'], [' SOY '])).toBe(true);
  expect(hasExcludedIngredient(['Crème fraîche'], ['crème fraîche'])).toBe(true);
  expect(hasExcludedIngredient(['Eggplant'], ['egg'])).toBe(false);
  expect(hasExcludedIngredient(['Flour'], [])).toBe(false);
});
