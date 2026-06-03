import { useCallback, useState } from 'react';

import { syncNow } from '@/lib/sync/engine';

/**
 * Minimum time the spinner stays up so a fast (or no-op, e.g. signed-out)
 * sync still reads as a deliberate pull rather than a flicker.
 */
const MIN_SPINNER_MS = 600;

/**
 * Drives a `RefreshControl` from a manual cloud sync: pull down → `syncNow()`
 * → the spinner clears once the sync settles (and at least `MIN_SPINNER_MS`
 * has elapsed). When there's no cloud account the sync is a no-op and the
 * spinner simply bounces — there's nothing to pull.
 */
export function useSyncRefresh() {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const settled = syncNow();
    const minimum = new Promise<void>((resolve) => setTimeout(resolve, MIN_SPINNER_MS));
    void Promise.all([settled, minimum]).then(() => setRefreshing(false));
  }, []);

  return { refreshing, onRefresh };
}
