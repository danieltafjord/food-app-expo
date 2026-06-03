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
