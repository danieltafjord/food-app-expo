/**
 * Server clock correction for the timestamps this device writes.
 *
 * Sync settles conflicts last-write-wins by the client `updated_at`, and the
 * server only clamps clocks running *ahead* of it. A phone running behind
 * stamps its edits in the past, so they quietly lose to older edits from the
 * rest of the household. The sync engine estimates the offset from each
 * response's server time (see `estimateClockOffset`), and `nowIso` adds it
 * wherever a row is stamped.
 *
 * A clock within `CLOCK_TOLERANCE_MS` (plus the measurement's own uncertainty)
 * is left alone: the `Date` header only has whole seconds, and nudging an
 * accurate clock by a noisy estimate would do more harm than good.
 */

export const CLOCK_TOLERANCE_MS = 2000;

let offsetMs = 0;

/** The current time, corrected towards the server's clock (epoch ms). */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function getClockOffset(): number {
  return offsetMs;
}

export function setClockOffset(ms: number): void {
  offsetMs = Number.isFinite(ms) ? Math.round(ms) : 0;
}

/**
 * Estimate the offset from one round trip: the server's time against the
 * midpoint of when the request left and the response arrived. `precisionMs`
 * is the server time's resolution (1000 for a `Date` header, which truncates
 * to the second). Returns 0 when the clock is within tolerance.
 */
export function estimateClockOffset(serverTime: number, sentAt: number, receivedAt: number, precisionMs: number): number {
  if (!Number.isFinite(serverTime) || !(receivedAt >= sentAt)) return offsetMs;
  const sample = serverTime + precisionMs / 2 - (sentAt + receivedAt) / 2;
  const uncertainty = precisionMs / 2 + (receivedAt - sentAt) / 2;
  return Math.abs(sample) <= CLOCK_TOLERANCE_MS + uncertainty ? 0 : Math.round(sample);
}
