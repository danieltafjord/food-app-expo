import { observable } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';
import { AppState } from 'react-native';

import { hapticSuccess, hapticWarning } from '@/lib/haptics';

/** How long a delete can be taken back before it is written to the store. */
const UNDO_WINDOW_MS = 5000;

type PendingDelete = {
  /** Changes for every new delete, so the toast re-enters instead of just swapping its text. */
  key: number;
  message: string;
  /** Ids screens should leave out while the delete is pending. */
  hidden: Record<string, true>;
};

const EMPTY: Record<string, true> = {};

const pending$ = observable<PendingDelete | null>(null);
// Kept outside the observable: Legend State treats functions in state as computeds.
let commit: (() => void) | null = null;
let revert: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let nextKey = 1;

/**
 * Delete with an Undo window. The rows disappear from the screens at once but
 * the store is only changed when the window closes, so an undone delete never
 * reaches the sync outbox (no tombstone to take back from the server).
 *
 * One delete is pending at a time: starting another commits the previous one.
 * Leaving the app commits too, so a delete isn't lost if the app is killed.
 */
export function deleteWithUndo(message: string, hiddenIds: string[], run: () => void): void {
  commitPendingDelete();
  hapticWarning();
  commit = run;
  pending$.set({
    key: nextKey++,
    message,
    hidden: Object.fromEntries(hiddenIds.map((id) => [id, true as const])),
  });
  timer = setTimeout(commitPendingDelete, UNDO_WINDOW_MS);
}

/**
 * The other direction: something was already added (a planned week), and Undo
 * takes it back. Shares the one toast with deletes; starting either replaces
 * the other, committing a pending delete first.
 */
export function addWithUndo(message: string, undo: () => void): void {
  commitPendingDelete();
  hapticSuccess();
  revert = undo;
  pending$.set({ key: nextKey++, message, hidden: {} });
  timer = setTimeout(commitPendingDelete, UNDO_WINDOW_MS);
}

/** Write the pending delete now (the window ran out, or another delete started). */
export function commitPendingDelete(): void {
  const run = commit;
  reset();
  run?.();
}

/** Take the pending delete back (the rows reappear untouched), or remove what was just added. */
export function undoPendingDelete(): void {
  const undo = revert;
  reset();
  undo?.();
}

function reset() {
  if (timer) clearTimeout(timer);
  timer = null;
  commit = null;
  revert = null;
  pending$.set(null);
}

AppState.addEventListener('change', (state) => {
  if (state !== 'active') commitPendingDelete();
});

/** The delete waiting on its Undo window, if any (drives the toast). */
export function usePendingDelete(): PendingDelete | null {
  return useValue(pending$);
}

/** Ids hidden by a pending delete. Stable (the same object) while nothing is pending. */
export function useHiddenIds(): Record<string, true> {
  return useValue(() => pending$.hidden.get() ?? EMPTY);
}
