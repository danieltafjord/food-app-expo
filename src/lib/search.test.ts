import { findExact, indexByName, searchIndex, searchKey } from '@/lib/search';

const names = [
  'Fiskesuppe',
  'Kjøttboller i brun saus',
  'Lasagne',
  'Pasta carbonara',
  'Pizza',
  'Taco pai',
  'Tacos',
  'Tomatsuppe',
];
const index = indexByName(names, (n) => n);

describe('searchKey', () => {
  it('lowercases, folds diacritics and collapses whitespace', () => {
    expect(searchKey('  Kjøtt   Boller ')).toBe('kjott boller');
    expect(searchKey('Blåbær')).toBe('blabaer');
  });
});

describe('searchIndex', () => {
  it('returns everything for an empty query', () => {
    expect(searchIndex(index, '')).toEqual(names);
    expect(searchIndex(index, '   ')).toEqual(names);
  });

  it('ranks exact, then prefix, then word-prefix, then substring', () => {
    expect(searchIndex(index, 'taco')).toEqual(['Taco pai', 'Tacos']);
    expect(searchIndex(index, 'tacos')).toEqual(['Tacos']);
    expect(searchIndex(index, 'suppe')).toEqual(['Fiskesuppe', 'Tomatsuppe']);
    expect(searchIndex(index, 'pa')).toEqual(['Pasta carbonara', 'Taco pai']);
  });

  it('ignores case and diacritics on both sides', () => {
    expect(searchIndex(index, 'KJOTT')).toEqual(['Kjøttboller i brun saus']);
    expect(searchIndex(index, 'kjøttb')).toEqual(['Kjøttboller i brun saus']);
  });

  it('returns nothing when no name contains the query', () => {
    expect(searchIndex(index, 'sushi')).toEqual([]);
  });
});

describe('findExact', () => {
  it('matches a name ignoring case, spacing and diacritics', () => {
    expect(findExact(index, ' tacos ')).toBe('Tacos');
    expect(findExact(index, 'kjottboller i  brun saus')).toBe('Kjøttboller i brun saus');
  });

  it('does not match a prefix or an empty query', () => {
    expect(findExact(index, 'taco')).toBeUndefined();
    expect(findExact(index, '')).toBeUndefined();
  });
});
