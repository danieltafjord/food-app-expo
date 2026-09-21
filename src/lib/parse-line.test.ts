import { amountText, isAmountValid, normalizeUnit, parseAmount, parseItemLine } from '@/lib/parse-line';

describe('parseItemLine', () => {
  it('reads "<qty> <unit> <name>"', () => {
    expect(parseItemLine('500 g kjøttdeig')).toEqual({ name: 'kjøttdeig', quantity: 500, unit: 'g' });
    expect(parseItemLine('2 dl melk')).toEqual({ name: 'melk', quantity: 2, unit: 'dl' });
    expect(parseItemLine('1,5 l Cola')).toEqual({ name: 'Cola', quantity: 1.5, unit: 'l' });
  });

  it('reads a glued unit', () => {
    expect(parseItemLine('500g kjøttdeig')).toEqual({ name: 'kjøttdeig', quantity: 500, unit: 'g' });
    expect(parseItemLine('2l melk')).toEqual({ name: 'melk', quantity: 2, unit: 'l' });
  });

  it('reads "<qty> <name>" with no unit', () => {
    expect(parseItemLine('2 melk')).toEqual({ name: 'melk', quantity: 2, unit: null });
    expect(parseItemLine('3 store løk')).toEqual({ name: 'store løk', quantity: 3, unit: null });
  });

  it('reads "<name> <qty> <unit>"', () => {
    expect(parseItemLine('kjøttdeig 500 g')).toEqual({ name: 'kjøttdeig', quantity: 500, unit: 'g' });
    expect(parseItemLine('Melk 2 liter')).toEqual({ name: 'Melk', quantity: 2, unit: 'l' });
  });

  it('keeps a trailing bare number as part of the name', () => {
    expect(parseItemLine('Cola 2')).toEqual({ name: 'Cola 2', quantity: null, unit: null });
  });

  it('normalises unit spellings', () => {
    expect(parseItemLine('500 gram kjøttdeig').unit).toBe('g');
    expect(parseItemLine('2 stykk løk').unit).toBe('stk');
    expect(parseItemLine('1 pakke bacon').unit).toBe('pk');
    expect(parseItemLine('2 tbsp olje').unit).toBe('ss');
  });

  it('reads fractions', () => {
    expect(parseItemLine('½ løk')).toEqual({ name: 'løk', quantity: 0.5, unit: null });
    expect(parseItemLine('1/2 dl fløte')).toEqual({ name: 'fløte', quantity: 0.5, unit: 'dl' });
    expect(parseItemLine('1 ½ dl fløte')).toEqual({ name: 'fløte', quantity: 1.5, unit: 'dl' });
  });

  it('leaves a plain name alone', () => {
    expect(parseItemLine('Melk')).toEqual({ name: 'Melk', quantity: null, unit: null });
    expect(parseItemLine('  Melk  ')).toEqual({ name: 'Melk', quantity: null, unit: null });
    expect(parseItemLine('')).toEqual({ name: '', quantity: null, unit: null });
  });
});

describe('parseAmount', () => {
  it('reads quantity and unit', () => {
    expect(parseAmount('500 g')).toEqual({ quantity: 500, unit: 'g' });
    expect(parseAmount('500g')).toEqual({ quantity: 500, unit: 'g' });
    expect(parseAmount('1,5 l')).toEqual({ quantity: 1.5, unit: 'l' });
  });

  it('reads a bare quantity or a bare unit', () => {
    expect(parseAmount('2')).toEqual({ quantity: 2, unit: null });
    expect(parseAmount('dl')).toEqual({ quantity: null, unit: 'dl' });
    expect(parseAmount('gram')).toEqual({ quantity: null, unit: 'g' });
  });

  it('returns nothing for empty or unparseable text', () => {
    expect(parseAmount('')).toEqual({ quantity: null, unit: null });
    expect(parseAmount('2 dl melk')).toEqual({ quantity: null, unit: null });
  });
});

describe('normalizeUnit / amountText', () => {
  it('maps aliases and keeps unknown units', () => {
    expect(normalizeUnit('Gram')).toBe('g');
    expect(normalizeUnit('st.')).toBe('stk');
    expect(normalizeUnit('porsjon')).toBe('porsjon');
    expect(normalizeUnit('')).toBeNull();
  });

  it('round-trips through amountText', () => {
    expect(amountText(500, 'g')).toBe('500 g');
    expect(amountText(1.5, null)).toBe('1,5');
    expect(amountText(null, 'dl')).toBe('dl');
    expect(amountText(null, null)).toBe('');
    expect(parseAmount(amountText(1.5, 'l'))).toEqual({ quantity: 1.5, unit: 'l' });
  });
});

describe('mixed fractions and unreadable amounts', () => {
  it('reads "1 1/2" as one number', () => {
    expect(parseItemLine('1 1/2 dl fløte')).toEqual({ name: 'fløte', quantity: 1.5, unit: 'dl' });
    expect(parseItemLine('fløte 1 1/2 dl')).toEqual({ name: 'fløte', quantity: 1.5, unit: 'dl' });
    expect(parseAmount('1 1/2 dl')).toEqual({ quantity: 1.5, unit: 'dl' });
    expect(parseAmount('2 1/4')).toEqual({ quantity: 2.25, unit: null });
  });

  it('still reads a plain count before a name', () => {
    expect(parseItemLine('2 store løk')).toEqual({ name: 'store løk', quantity: 2, unit: null });
    expect(parseItemLine('1/2 agurk')).toEqual({ name: 'agurk', quantity: 0.5, unit: null });
  });

  it('flags amount text that would be saved as nothing', () => {
    expect(isAmountValid('')).toBe(true);
    expect(isAmountValid('500 g')).toBe(true);
    expect(isAmountValid('dl')).toBe(true);
    expect(isAmountValid('ca 2 dl')).toBe(false);
    expect(isAmountValid('1-2')).toBe(false);
    expect(isAmountValid('1 1/')).toBe(false);
  });

  it('rounds float noise out of the editable text', () => {
    expect(amountText(1 / 3, 'dl')).toBe('0,333 dl');
    expect(amountText(0.1 + 0.2, 'l')).toBe('0,3 l');
    expect(amountText(1.5, null)).toBe('1,5');
  });
});


it('rejects amounts beyond the server limits', () => {
  expect(isAmountValid('1000000 g')).toBe(false);
  expect(isAmountValid('1 ' + 'a'.repeat(51))).toBe(false);
  expect(isAmountValid('999999.99 g')).toBe(true);
});
