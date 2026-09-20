/**
 * One-line item entry: "500 g kjøttdeig", "2 dl melk", "kjøttdeig 500 g",
 * "2 melk" or just "melk" → name + quantity + unit in one go.
 *
 * Units are recognised from a small alias table (Norwegian first, English
 * where it's cheap) and normalised to a canonical short form, so "gram", "gr"
 * and "g" all become "g". That matters downstream: a generated shopping list
 * aggregates by ingredient + unit, so two spellings of the same unit would
 * otherwise become two lines.
 */

import { parseQuantity } from '@/lib/format';

export type ParsedLine = {
  name: string;
  quantity: number | null;
  unit: string | null;
};

export type ParsedAmount = Pick<ParsedLine, 'quantity' | 'unit'>;

/** Canonical unit → every spelling that maps to it (lower-case, no trailing dot). */
const UNIT_ALIASES: Record<string, readonly string[]> = {
  stk: ['stk', 'st', 'stykk', 'stykker', 'pc', 'pcs', 'piece', 'pieces', 'x'],
  g: ['g', 'gr', 'gram', 'grams'],
  kg: ['kg', 'kilo', 'kilogram'],
  ml: ['ml', 'milliliter', 'millilitre'],
  cl: ['cl', 'centiliter'],
  dl: ['dl', 'desiliter', 'deciliter'],
  l: ['l', 'liter', 'litre', 'ltr', 'liters'],
  ss: ['ss', 'spiseskje', 'spiseskjeer', 'tbsp', 'tablespoon', 'tablespoons'],
  ts: ['ts', 'teskje', 'teskjeer', 'tsp', 'teaspoon', 'teaspoons'],
  pk: ['pk', 'pakke', 'pakker', 'pakning', 'pack', 'packs', 'package'],
  boks: ['boks', 'bokser', 'can', 'cans', 'tin'],
  pose: ['pose', 'poser', 'bag', 'bags'],
  glass: ['glass', 'jar', 'jars'],
  flaske: ['flaske', 'flasker', 'bottle', 'bottles', 'fl'],
  fedd: ['fedd', 'clove', 'cloves'],
  skive: ['skive', 'skiver', 'slice', 'slices'],
  bunt: ['bunt', 'bunter', 'bunch'],
  kopp: ['kopp', 'kopper', 'cup', 'cups'],
  neve: ['neve', 'never', 'handful'],
  klype: ['klype', 'pinch'],
};

/** Units offered as one-tap chips, most common first. */
export const UNIT_SUGGESTIONS: readonly string[] = ['stk', 'g', 'kg', 'dl', 'l', 'ss', 'ts', 'pk', 'boks'];

const aliasToUnit = new Map<string, string>();
for (const [unit, aliases] of Object.entries(UNIT_ALIASES)) {
  for (const alias of aliases) aliasToUnit.set(alias, unit);
}

/**
 * Canonical spelling of a unit the user typed, or the trimmed input when it is
 * not one we know ("porsjon" stays "porsjon"). Empty input → null.
 */
export function normalizeUnit(text: string | null | undefined): string | null {
  const key = (text ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!key) return null;
  return aliasToUnit.get(key) ?? key;
}

/** True when `token` is a unit spelling we recognise. */
function isKnownUnit(token: string): boolean {
  return aliasToUnit.has(token.toLowerCase().replace(/\.$/, ''));
}

const VULGAR: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

/** "1,5" / "1.5" / "1/2" / "½" / "1 ½" / "1 1/2" → number, or null. */
function parseNumber(token: string): number | null {
  const t = token.trim();
  if (t in VULGAR) return VULGAR[t];
  const mixedFrac = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixedFrac && Number(mixedFrac[3]) !== 0) {
    return Number(mixedFrac[1]) + Number(mixedFrac[2]) / Number(mixedFrac[3]);
  }
  const mixed = t.match(/^(\d+)\s*([½¼¾⅓⅔])$/);
  if (mixed) return Number(mixed[1]) + VULGAR[mixed[2]];
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac && Number(frac[2]) !== 0) return Number(frac[1]) / Number(frac[2]);
  return parseQuantity(t);
}

// A number: 2, 1,5, 1.5, 1/2, ½, 1 ½, 1 1/2 (the mixed fraction first, so
// "1 1/2 dl" is not read as 1 × "1/2 dl").
const NUM = '(?:\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+(?:[.,]\\d+)?(?:\\s*\\/\\s*\\d+)?(?:\\s*[½¼¾⅓⅔])?|[½¼¾⅓⅔])';
// A unit token: letters only (so "2l" and "500g" split cleanly).
const UNIT = '([\\p{L}]+\\.?)';

const LEADING = new RegExp(`^(${NUM})\\s*${UNIT}?\\s+(.+)$`, 'u');
const LEADING_GLUED = new RegExp(`^(${NUM})${UNIT}\\s+(.+)$`, 'u');
const TRAILING = new RegExp(`^(.+?)\\s+(${NUM})\\s*${UNIT}?$`, 'u');
const AMOUNT_ONLY = new RegExp(`^(${NUM})\\s*${UNIT}?$`, 'u');

/**
 * Split a typed line into name, quantity and unit. The unit is only taken
 * when it is a spelling we know; otherwise the word belongs to the name
 * ("2 store løk" → 2 × "store løk").
 */
export function parseItemLine(text: string): ParsedLine {
  const raw = text.trim().replace(/\s+/g, ' ');
  if (!raw) return { name: '', quantity: null, unit: null };

  let m = raw.match(LEADING_GLUED) ?? raw.match(LEADING);
  if (m) {
    const [, num, unitToken, rest] = m;
    const quantity = parseNumber(num);
    if (quantity != null) {
      if (unitToken && isKnownUnit(unitToken)) {
        return { name: rest.trim(), quantity, unit: normalizeUnit(unitToken) };
      }
      // Not a unit → the token is the first word of the name.
      const name = [unitToken, rest].filter(Boolean).join(' ').trim();
      return { name, quantity, unit: null };
    }
  }

  m = raw.match(TRAILING);
  if (m) {
    const [, name, num, unitToken] = m;
    const quantity = parseNumber(num);
    // Trailing form requires a known unit so "Cola 2" stays a name.
    if (quantity != null && unitToken && isKnownUnit(unitToken)) {
      return { name: name.trim(), quantity, unit: normalizeUnit(unitToken) };
    }
  }

  return { name: raw, quantity: null, unit: null };
}

/**
 * Parse the contents of an amount-only field ("500 g", "2", "dl", "1,5 l").
 * A lone unit is allowed (quantity unknown, unit remembered).
 */
export function parseAmount(text: string): ParsedAmount {
  const raw = text.trim();
  if (!raw) return { quantity: null, unit: null };
  const m = raw.match(AMOUNT_ONLY);
  if (m) {
    const quantity = parseNumber(m[1]);
    const unit = m[2] ? normalizeUnit(m[2]) : null;
    if (quantity != null) return { quantity, unit };
  }
  if (/^[\p{L}]+\.?$/u.test(raw)) return { quantity: null, unit: normalizeUnit(raw) };
  return { quantity: null, unit: null };
}

/**
 * True when an amount field's text can be saved as typed: empty, or something
 * `parseAmount` understands. "ca 2 dl" or "1-2" are not — saving those would
 * silently store no amount at all, so the forms flag them instead.
 */
export function isAmountValid(text: string): boolean {
  if (!text.trim()) return true;
  const { quantity, unit } = parseAmount(text);
  return quantity != null || unit != null;
}

/** The editable text for an amount field: "500 g", "2", "g" or "". */
export function amountText(quantity: number | null, unit: string | null): string {
  // Three decimals at most: 1/3 shows as "0,333", not "0,3333333333333333".
  const qty =
    quantity != null && Number.isFinite(quantity)
      ? String(Math.round(quantity * 1000) / 1000).replace('.', ',')
      : '';
  return [qty, unit ?? ''].filter(Boolean).join(' ');
}
