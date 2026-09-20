import { fold } from '@/lib/categorize/normalize';

/**
 * In-memory name search for the pickers ("search or create" fields).
 *
 * Everything the household owns is already in the local store, so search is a
 * synchronous scan over pre-folded names — no debounce, no async, results are
 * ready on the same keystroke. Matching is diacritic- and case-insensitive
 * ("tacos" hits "Tacos", "kjottboller" hits "Kjøttboller"), and results are
 * ranked so the closest name is first:
 *
 *   1. exact name
 *   2. name starts with the query
 *   3. a later word starts with the query
 *   4. the query appears anywhere
 *
 * Ties keep the input order (callers pass their lists alphabetised).
 */

/** The comparable form of a name or query. */
export function searchKey(s: string): string {
  // Lowercase first: `fold` only knows the lowercase ø/æ, so "Øl" must become
  // "øl" before folding or it would keep its ø and never match the query "øl".
  return fold(s.toLowerCase()).replace(/\s+/g, ' ').trim();
}

export type Indexed<T> = { item: T; key: string };

/** Pre-fold a list once so each keystroke only compares strings. */
export function indexByName<T>(items: readonly T[], name: (item: T) => string): Indexed<T>[] {
  return items.map((item) => ({ item, key: searchKey(name(item)) }));
}

const enum Rank {
  Exact = 0,
  Prefix = 1,
  WordPrefix = 2,
  Contains = 3,
}

function rank(key: string, query: string): Rank | null {
  const at = key.indexOf(query);
  if (at === -1) return null;
  if (at === 0) return key.length === query.length ? Rank.Exact : Rank.Prefix;
  if (key[at - 1] === ' ') return Rank.WordPrefix;
  return Rank.Contains;
}

/**
 * Items whose name matches `query`, best first. An empty query returns
 * everything in the index's order.
 */
export function searchIndex<T>(index: readonly Indexed<T>[], query: string): T[] {
  const q = searchKey(query);
  if (!q) return index.map((entry) => entry.item);
  const hits: { item: T; rank: Rank; order: number }[] = [];
  index.forEach((entry, order) => {
    const r = rank(entry.key, q);
    if (r !== null) hits.push({ item: entry.item, rank: r, order });
  });
  hits.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return hits.map((hit) => hit.item);
}

/** The item whose name equals `query` (ignoring case, spacing and diacritics), if any. */
export function findExact<T>(index: readonly Indexed<T>[], query: string): T | undefined {
  const q = searchKey(query);
  if (!q) return undefined;
  return index.find((entry) => entry.key === q)?.item;
}
