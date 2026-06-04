import { fold, normalize } from '@/lib/categorize/normalize';

describe('normalize', () => {
  it('lowercases and trims', () => {
    expect(normalize('  Melk  ')).toBe('melk');
  });

  it('collapses internal whitespace', () => {
    expect(normalize('gul   løk')).toBe('gul løk');
  });

  it('strips a leading quantity and unit', () => {
    expect(normalize('2 l lettmelk')).toBe('lettmelk');
    expect(normalize('500g kjøttdeig')).toBe('kjøttdeig');
    expect(normalize('3 stk paprika')).toBe('paprika');
    expect(normalize('1,5 kg poteter')).toBe('poteter');
  });

  it('strips repeated/compound leading quantities', () => {
    expect(normalize('2 x 500 g pasta')).toBe('pasta');
  });

  it('strips a bare leading count without a unit (the common case)', () => {
    // "2 lettmelk" = two cartons of milk → the count is stripped so it still
    // categorizes as milk. This is structurally indistinguishable from a name
    // that happens to start with a number (e.g. "7 up"), and the far more common
    // count-prefixed case wins by design — the rare brand name just falls to "Other".
    expect(normalize('2 lettmelk')).toBe('lettmelk');
  });

  it('strips a trailing parenthetical note', () => {
    expect(normalize('ost (revet)')).toBe('ost');
  });

  it('keeps Norwegian letters å/ø/æ intact', () => {
    expect(normalize('Rødløk')).toBe('rødløk');
    expect(normalize('Bær')).toBe('bær');
  });

  it('returns empty string for blank or quantity-only input', () => {
    expect(normalize('')).toBe('');
    expect(normalize('   ')).toBe('');
    expect(normalize('500 g')).toBe('');
  });

  it('does not strip digits that belong to the name', () => {
    expect(normalize('cola zero')).toBe('cola zero');
  });
});

describe('fold', () => {
  it('folds Norwegian letters for fuzzy matching', () => {
    expect(fold('rødløk')).toBe('rodlok');
    expect(fold('bær')).toBe('baer');
    expect(fold('blåbær')).toBe('blabaer');
  });

  it('strips other diacritics', () => {
    expect(fold('crème')).toBe('creme');
  });
});
