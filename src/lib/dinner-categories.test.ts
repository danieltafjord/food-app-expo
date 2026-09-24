import { dinnerCategory, matchesDinnerCategory, searchDinners } from './dinner-categories';
import { indexByName } from './search';

const dinners = [
  { name: 'Tacos', category: 'meat' },
  { name: 'Bean tacos', category: 'vegetarian' },
  { name: 'Soup', category: null },
  { name: 'Leftovers', category: 'other' },
];
const index = indexByName(dinners, (dinner) => dinner.name);

it('keeps the existing dinner action when a category filter hides the exact name', () => {
  expect(searchDinners(index, ' TACOS ', 'vegetarian')).toEqual({
    results: [dinners[1]], exact: dinners[0],
  });
});

it('combines ranked name search with category filtering and distinguishes other from unassigned', () => {
  expect(searchDinners(index, 'tacos', 'all').results).toEqual([dinners[0], dinners[1]]);
  expect(searchDinners(index, '', 'none').results).toEqual([dinners[2]]);
  expect(searchDinners(index, '', 'other').results).toEqual([dinners[3]]);
  expect(searchDinners(index, 'salmon', 'fish')).toEqual({ results: [], exact: undefined });
});

it('keeps uncategorized and future categories browsable without rewriting their values', () => {
  expect(dinnerCategory('future-category')).toBeNull();
  expect(matchesDinnerCategory(undefined, 'all')).toBe(true);
  expect(matchesDinnerCategory('future-category', 'none')).toBe(true);
  expect(matchesDinnerCategory('fish', 'vegetarian')).toBe(false);
});
