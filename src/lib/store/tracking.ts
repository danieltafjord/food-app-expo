import { batch } from '@legendapp/state';

let suspended = 0;

/**
 * Apply store writes that are not edits and must not reach the sync outbox:
 * moving an archived list's items out of the store and back. The rows are
 * unchanged — they are only kept somewhere else on the device.
 *
 * Not for use inside another `batch`: the sync engine hears about a batch
 * when the outermost one ends, which would be after this has returned.
 */
export function untracked(write: () => void): void {
  suspended += 1;
  try {
    batch(write);
  } finally {
    suspended -= 1;
  }
}

/** Whether the store changes being notified right now come from `untracked`. */
export function isTrackingSuspended(): boolean {
  return suspended > 0;
}
