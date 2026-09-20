/**
 * Text normalization for grocery item names, tuned for Norwegian (Bokmål).
 *
 * Two transforms, used by the categorizer (see `./index`):
 *
 *  - `normalize(raw)` — the canonical lookup key: lowercased, whitespace
 *    collapsed, with any leading quantity + unit ("2 l", "500g", "3 stk") and
 *    trailing parenthetical note stripped, but the Norwegian letters å/ø/æ kept
 *    intact (they're distinct letters, not accents). Exact dictionary matching
 *    happens on this form.
 *
 *  - `fold(s)` — a diacritic-folded form (å→a, ø→o, æ→ae, é→e …) used only for
 *    fuzzy/compound matching, so a missing or mistyped diacritic ("rodlok" for
 *    "rødløk") still matches. Applied to both the query and the dictionary keys.
 *
 * No stemming is done here on purpose: Norwegian suffix-stripping is fragile
 * (filet→fil, sukker→sukk), so plurals/inflections are left to the fuzzy layer
 * and to synonyms in the dictionary.
 */

/** Unit words that may trail a leading quantity and should be stripped with it. */
const UNITS = [
  'stk',
  'pk',
  'pakke',
  'pakker',
  'boks',
  'bokser',
  'glass',
  'flaske',
  'flasker',
  'pose',
  'poser',
  'beger',
  'kartong',
  'kartonger',
  'bunt',
  'kg',
  'hg',
  'g',
  'gram',
  'l',
  'dl',
  'cl',
  'ml',
  'liter',
  'ts',
  'ss',
  'kopp',
  'klype',
  'neve',
];

const UNIT_GROUP = UNITS.join('|');
// A leading "2", "2,5", "500g", "3 stk", "1 x", "2x500 g" … chunk.
const LEADING_QTY = new RegExp(
  `^\\s*\\d+(?:[.,]\\d+)?\\s*(?:x\\s*)?(?:${UNIT_GROUP})?\\b\\.?\\s*`,
  'i',
);
const TRAILING_PAREN = /\s*\([^)]*\)\s*$/;
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Reduce a raw item line to its canonical lookup key. May return '' if the
 * input was only a quantity/blank — callers treat that as "uncategorizable".
 */
export function normalize(raw: string): string {
  let s = (raw ?? '').toLowerCase().trim();
  if (!s) {
    return '';
  }
  s = s.replace(TRAILING_PAREN, '');
  // Strip one or more leading quantity chunks ("2 x 500 g pasta" → "pasta").
  let prev: string;
  do {
    prev = s;
    s = s.replace(LEADING_QTY, '');
  } while (s !== prev && s.length > 0);
  // Collapse any internal whitespace runs.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Diacritic-fold for fuzzy matching: å→a, ø→o, æ→ae, é→e, etc. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(COMBINING_MARKS, '').replace(/ø/g, 'o').replace(/Ø/g, 'O').replace(/æ/g, 'ae').replace(/Æ/g, 'AE');
}
