import { router, type Href } from 'expo-router';

/** Two pushes of the same destination inside this window count as one tap. */
const DOUBLE_TAP_MS = 700;

let last: { key: string; at: number } = { key: '', at: 0 };

/**
 * `router.push`, minus the duplicate a fast double tap produces. The push does
 * not land until the next frame at the earliest, so a second tap on the same
 * row or button still reaches its handler and would stack the screen twice
 * (back then "does nothing" once). A different destination is never blocked.
 *
 * Pass `key` when the params differ on every call (a fresh request id), so the
 * two taps still compare equal. Returns false when the push was dropped.
 */
export function pushOnce(href: Href, key: string = JSON.stringify(href)): boolean {
  const now = Date.now();
  if (key === last.key && now - last.at < DOUBLE_TAP_MS) return false;
  last = { key, at: now };
  router.push(href);
  return true;
}
