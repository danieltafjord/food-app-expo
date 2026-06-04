import { categorize } from '@/lib/categorize';

describe('categorize — exact dictionary hits', () => {
  it.each([
    ['melk', 'dairy'],
    ['kyllingfilet', 'meat'],
    ['banan', 'produce'],
    ['rødløk', 'produce'],
    ['laks', 'fish'],
    ['toalettpapir', 'household'],
    ['tannkrem', 'personal_care'],
    ['olivenolje', 'spices'],
    ['knekkebrød', 'bakery'],
  ])('%s → %s', (input, expected) => {
    expect(categorize(input)).toBe(expected);
  });

  it('is case-insensitive and trims', () => {
    expect(categorize('  Kyllingfilet ')).toBe('meat');
  });
});

describe('categorize — quantity prefixes', () => {
  it('ignores a leading quantity and unit', () => {
    expect(categorize('2 l lettmelk')).toBe('dairy');
    expect(categorize('500 g kjøttdeig')).toBe('meat');
    expect(categorize('3 stk paprika')).toBe('produce');
  });
});

describe('categorize — folded (missing/typo diacritics)', () => {
  it('matches when å/ø/æ are written as plain letters', () => {
    expect(categorize('rodlok')).toBe('produce');
    expect(categorize('blabaer')).toBe('produce');
  });
});

describe('categorize — compounds and multiword (head match)', () => {
  it('finds the head of a Norwegian compound', () => {
    expect(categorize('kyllinglårfilet')).toBe('meat');
    expect(categorize('jordbærsyltetøy')).toBe('produce'); // jordbær is the head
  });

  it('finds a known word inside a multiword line', () => {
    expect(categorize('økologiske bananer')).toBe('produce');
  });
});

describe('categorize — fuzzy (plurals and typos)', () => {
  it('matches plural forms not stored explicitly', () => {
    expect(categorize('appelsiner')).toBe('produce'); // appelsin + er
  });

  it('tolerates a small typo on a longer word', () => {
    expect(categorize('kjøttdei')).toBe('meat');
  });

  it('does NOT fuzzy-match very short words (avoids false positives)', () => {
    // "lis" is 3 chars → exact-only; must not snap to "is"/"ris"/"laks".
    expect(categorize('lis')).toBeNull();
  });
});

describe('categorize — unknown', () => {
  it('returns null for items not in the dictionary', () => {
    expect(categorize('zzxq widget')).toBeNull();
    expect(categorize('')).toBeNull();
  });
});
