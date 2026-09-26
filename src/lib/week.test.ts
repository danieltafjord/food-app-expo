import {
  addDays,
  addWeeks,
  dateKeyOf,
  fromDateKey,
  isoWeekNumber,
  startOfWeek,
  toDateKey,
  weekLabel,
} from '@/lib/week';

describe('toDateKey', () => {
  it('formats local Y-M-D, zero-padded', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('uses local time, not UTC (no off-by-one in the evening)', () => {
    // Late local evening must not roll forward to the next UTC day.
    expect(toDateKey(new Date(2026, 5, 1, 23, 30))).toBe('2026-06-01');
  });
});

describe('fromDateKey', () => {
  it('parses a key into a local-midnight Date', () => {
    const d = fromDateKey('2026-06-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(1);
  });

  it('round-trips with toDateKey', () => {
    for (const key of ['2026-01-01', '2026-06-07', '2026-12-31']) {
      expect(toDateKey(fromDateKey(key))).toBe(key);
    }
  });
});

describe('dateKeyOf', () => {
  it('slices the date out of an ISO datetime', () => {
    expect(dateKeyOf('2026-06-01T12:00:00.000Z')).toBe('2026-06-01');
  });

  it('returns empty string for null/undefined', () => {
    expect(dateKeyOf(null)).toBe('');
    expect(dateKeyOf(undefined)).toBe('');
  });
});

describe('addDays / addWeeks', () => {
  it('crosses month and year boundaries', () => {
    expect(toDateKey(addDays(new Date(2026, 0, 31), 1))).toBe('2026-02-01');
    expect(toDateKey(addDays(new Date(2026, 11, 31), 1))).toBe('2027-01-01');
    expect(toDateKey(addDays(new Date(2026, 5, 10), -1))).toBe('2026-06-09');
  });

  it('moves whole weeks', () => {
    expect(toDateKey(addWeeks(new Date(2026, 5, 1), 1))).toBe('2026-06-08');
    expect(toDateKey(addWeeks(new Date(2026, 5, 1), -2))).toBe('2026-05-18');
  });
});

describe('startOfWeek (Monday-based)', () => {
  it('returns the same day for a Monday', () => {
    // 2026-06-01 is a Monday.
    expect(toDateKey(startOfWeek(new Date(2026, 5, 1)))).toBe('2026-06-01');
  });

  it('returns the Monday for a mid-week day', () => {
    expect(toDateKey(startOfWeek(new Date(2026, 5, 3)))).toBe('2026-06-01'); // Wed
    expect(toDateKey(startOfWeek(new Date(2026, 5, 6)))).toBe('2026-06-01'); // Sat
  });

  it('wraps a Sunday back to the previous Monday (not forward)', () => {
    // 2026-06-07 is a Sunday — must map to Mon 2026-06-01, not 2026-06-08.
    expect(toDateKey(startOfWeek(new Date(2026, 5, 7)))).toBe('2026-06-01');
  });

  it('normalizes away the time component', () => {
    expect(toDateKey(startOfWeek(new Date(2026, 5, 3, 23, 59)))).toBe('2026-06-01');
  });
});

describe('weekLabel', () => {
  it('collapses the month when start and end share it', () => {
    expect(weekLabel(new Date(2026, 5, 1), 'en-US')).toBe('Jun 1 – 7');
  });

  it('shows both months across a boundary', () => {
    expect(weekLabel(new Date(2026, 5, 29), 'en-US')).toBe('Jun 29 – Jul 5');
  });

  it('puts the day first, with its dot, in Norwegian', () => {
    expect(weekLabel(new Date(2026, 8, 21), 'nb')).toBe('21.–27. sep.');
    expect(weekLabel(new Date(2026, 8, 28), 'nb')).toBe('28. sep. – 4. okt.');
  });
});

describe('isoWeekNumber', () => {
  it('numbers weeks the ISO way (Monday start, week 1 holds the first Thursday)', () => {
    expect(isoWeekNumber(new Date(2026, 8, 21))).toBe(39); // Mon
    expect(isoWeekNumber(new Date(2026, 8, 27))).toBe(39); // Sun, same week
    expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1); // Thu
    expect(isoWeekNumber(new Date(2027, 0, 1))).toBe(53); // Fri, still 2026's last week
    expect(isoWeekNumber(new Date(2024, 11, 30))).toBe(1); // Mon, already 2025's week 1
  });
});
