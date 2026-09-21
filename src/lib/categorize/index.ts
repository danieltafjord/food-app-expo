/**
 * On-device grocery item categorization.
 *
 * `categorize(name)` maps a raw item line ("2 l lettmelk", "Kyllingfilet",
 * "rødløk") to a stable aisle {@link CategoryId}, or `null` when it can't place
 * it (the caller then falls back to `'other'`). Everything here is pure,
 * synchronous, offline, and dependency-free — it runs on the device. Results
 * are memoized per normalized name, so the read paths that fall back to it for
 * uncategorized items (shopping list sections) pay a map lookup, not the
 * head-match/fuzzy passes, on every selector run.
 *
 * Matching pipeline, fail-cheap-first:
 *   1. exact      — normalized key in the dictionary (most hits land here)
 *   2. exact-fold — diacritic-folded key ("rodlok" → "rødløk")
 *   3. head/word  — a dictionary word is a prefix/suffix/whole-word of the query
 *                   (handles Norwegian compounds: "kyllinglårfilet" → kylling)
 *   4. fuzzy      — bounded, length-aware edit distance (plurals, typos)
 *
 * ── Extending ──────────────────────────────────────────────────────────────
 * To grow coverage, add words to `./dictionary` — no code change needed.
 *
 * Optional cloud enrichment is handled separately by AiClassificationWorker.
 * It sends residual unknowns to our authenticated server and stores accepted
 * categories on unchanged ingredients. This function remains synchronous.
 */

import { DICTIONARY, DICTIONARY_EN } from './dictionary';
import { fold, normalize } from './normalize';
import { type CategoryId } from './taxonomy';

export {
  CATEGORY_EMOJI,
  CATEGORY_IDS,
  CATEGORY_ORDER,
  coerceCategory,
  isCategoryId,
  type CategoryId,
} from './taxonomy';

type FoldedKey = { key: string; category: CategoryId };

/** Exact lookup on the normalized (diacritic-preserving) key. */
const EXACT = new Map<string, CategoryId>();
/** Exact lookup on the folded key, so a missing/wrong diacritic still hits. */
const EXACT_FOLDED = new Map<string, CategoryId>();
/** Folded keys (len ≥ 4) for the head/word and fuzzy passes, longest first. */
const FOLDED_KEYS: FoldedKey[] = [];

for (const group of [...DICTIONARY, ...DICTIONARY_EN]) {
  for (const word of group.words) {
    const norm = normalize(word);
    if (!norm) {
      continue;
    }
    if (!EXACT.has(norm)) {
      EXACT.set(norm, group.category);
    }
    const folded = fold(norm);
    if (!EXACT_FOLDED.has(folded)) {
      EXACT_FOLDED.set(folded, group.category);
    }
    if (folded.length >= 4) {
      FOLDED_KEYS.push({ key: folded, category: group.category });
    }
  }
}
// Longest key first so the head/word pass prefers the most specific match.
FOLDED_KEYS.sort((a, b) => b.key.length - a.key.length);

/** Edit-distance tolerance for a query of the given (folded) length. */
function maxDistanceFor(length: number): number {
  if (length <= 3) {
    return 0;
  }
  if (length <= 5) {
    return 1;
  }
  if (length <= 8) {
    return 2;
  }
  return 3;
}

/**
 * Levenshtein distance between `a` and `b`, abandoned early once the best
 * possible distance on a row exceeds `cap` (returns `cap + 1`). The cap keeps
 * this cheap — we only care whether a candidate is within tolerance.
 */
function boundedLevenshtein(a: string, b: string, cap: number): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > cap) {
    return cap + 1;
  }
  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j += 1) {
    prev[j] = j;
  }
  for (let i = 1; i <= al; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j += 1) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) {
        rowMin = curr[j];
      }
    }
    if (rowMin > cap) {
      return cap + 1;
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

/** Step 3: a dictionary word is a prefix/suffix/whole word of the query. */
function headMatch(folded: string): CategoryId | null {
  const words = folded.includes(' ') ? folded.split(' ') : null;
  for (const { key, category } of FOLDED_KEYS) {
    if (key.length > folded.length || key === folded) {
      continue;
    }
    if (folded.startsWith(key) || folded.endsWith(key) || (words !== null && words.includes(key))) {
      return category;
    }
  }
  return null;
}

/** Step 4: nearest dictionary key within the length-aware distance budget. */
function fuzzyMatch(folded: string): CategoryId | null {
  const cap = maxDistanceFor(folded.length);
  if (cap === 0) {
    return null;
  }
  let best: CategoryId | null = null;
  let bestDist = cap + 1;
  let bestLen = Infinity;
  for (const { key, category } of FOLDED_KEYS) {
    if (Math.abs(key.length - folded.length) > cap) {
      continue;
    }
    const dist = boundedLevenshtein(folded, key, cap);
    if (dist < bestDist || (dist === bestDist && key.length < bestLen)) {
      best = category;
      bestDist = dist;
      bestLen = key.length;
    }
  }
  return bestDist <= cap ? best : null;
}

/**
 * Categorize a raw grocery item name into an aisle, or `null` if unknown.
 * Pure and synchronous; safe to call from store mutations.
 */
export function categorize(rawName: string): CategoryId | null {
  const norm = normalize(rawName);
  if (!norm) {
    return null;
  }
  const exact = EXACT.get(norm);
  if (exact) {
    return exact;
  }
  const cached = MEMO.get(norm);
  if (cached !== undefined) {
    return cached;
  }
  const folded = fold(norm);
  const result = EXACT_FOLDED.get(folded) ?? headMatch(folded) ?? fuzzyMatch(folded);
  remember(norm, result);
  return result;
}

/**
 * Names that missed the exact table, with their (possibly null) answer. The
 * slow passes are deterministic, so caching is safe; the cap keeps a device
 * with a long history from growing it without bound (insertion order = FIFO).
 */
const MEMO = new Map<string, CategoryId | null>();
const MEMO_MAX = 2000;

function remember(key: string, value: CategoryId | null): void {
  if (MEMO.size >= MEMO_MAX) {
    const oldest = MEMO.keys().next().value;
    if (oldest !== undefined) MEMO.delete(oldest);
  }
  MEMO.set(key, value);
}
