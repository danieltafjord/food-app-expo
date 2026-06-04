import * as Crypto from 'expo-crypto';

/**
 * Client-generated id for a new local entity.
 *
 * `Crypto.randomUUID()` is synchronous, which is what keeps every store
 * mutation synchronous (create → return id → navigate immediately, no await).
 * The same UUID becomes the row's identity on the server during Phase-2 sync.
 */
export function newId(): string {
  return Crypto.randomUUID();
}

/** ISO timestamp for `created_at` / `updated_at`. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Crash-proof ascending comparison of two ISO timestamps. Older persisted rows
 * can carry a non-string (or missing) `created_at`; coercing to string and using
 * plain relational operators tolerates that — unlike `localeCompare`, which is
 * `undefined` on a number and throws "undefined is not a function".
 */
export function compareIso(a: string | null | undefined, b: string | null | undefined): number {
  const x = a == null ? '' : String(a);
  const y = b == null ? '' : String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
