import { observable } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';

/**
 * Rows another device just added or changed, so screens can flash them: an
 * item someone ticked in the shop, a dinner moved to another day. Only rows a
 * person looks at on a shared screen are noted (shopping list items and plan
 * entries), and never on a device's first download.
 */

/** How long a row counts as "just changed". Screens fade their highlight over this. */
export const REMOTE_CHANGE_MS = 3500;

/** id → epoch ms it arrived. A new arrival for the same row restarts its highlight. */
const remoteChanges$ = observable<Record<string, number>>({});

let pruneTimer: ReturnType<typeof setTimeout> | null = null;

export function noteRemoteChanges(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const at = Date.now();
  remoteChanges$.assign(Object.fromEntries(ids.map((id) => [id, at])));
  schedulePrune();
}

/** When this row last arrived from another device, while that is recent; else undefined. */
export function useRemoteChange(id: string): number | undefined {
  return useValue(() => remoteChanges$[id].get());
}

/** Test-only. */
export function __resetRemoteChangesForTests(): void {
  if (pruneTimer) clearTimeout(pruneTimer);
  pruneTimer = null;
  remoteChanges$.set({});
}

export function remoteChangesForTests(): Record<string, number> {
  return remoteChanges$.peek();
}

function schedulePrune(): void {
  if (pruneTimer) return;
  pruneTimer = setTimeout(prune, REMOTE_CHANGE_MS);
}

function prune(): void {
  pruneTimer = null;
  const cutoff = Date.now() - REMOTE_CHANGE_MS;
  const all = remoteChanges$.peek();
  let left = false;
  for (const [id, at] of Object.entries(all)) {
    if (at <= cutoff) remoteChanges$[id].delete();
    else left = true;
  }
  if (left) schedulePrune();
}
