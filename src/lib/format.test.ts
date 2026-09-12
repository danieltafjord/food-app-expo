import { formatDate, parseQuantity } from '@/lib/format';

describe('parseQuantity', () => {
  it('accepts a dot decimal', () => {
    expect(parseQuantity('1.5')).toBe(1.5);
  });

  it('accepts a comma decimal (nb-NO keypad)', () => {
    expect(parseQuantity('1,5')).toBe(1.5);
    expect(parseQuantity('0,25')).toBe(0.25);
  });

  it('trims whitespace and accepts integers', () => {
    expect(parseQuantity(' 200 ')).toBe(200);
  });

  it('returns null for empty input', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('   ')).toBeNull();
  });

  it('returns null for non-numeric or negative input', () => {
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity('1,5,5')).toBeNull();
    expect(parseQuantity('-2')).toBeNull();
    expect(parseQuantity('Infinity')).toBeNull();
  });
});

describe('formatDate', () => {
  it('treats a YYYY-MM-DD key as a local calendar day regardless of timezone', () => {
    // A UTC-parsed '2026-06-01' would render as May 31 west of Greenwich; the
    // local parse must always yield the 1st.
    expect(formatDate('2026-06-01')).toMatch(/\b1\b/);
    expect(formatDate('2026-06-01')).not.toMatch(/31/);
  });

  it('still formats full ISO datetimes and passes through garbage', () => {
    expect(formatDate('2026-06-01T12:00:00.000Z')).toMatch(/2026/);
    expect(formatDate('not a date')).toBe('not a date');
    expect(formatDate(null)).toBe('');
  });
});
