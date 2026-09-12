import { useValue } from '@legendapp/state/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppErrorBoundary } from '@/components/error-boundary';
import { ensureChangeTracking } from '@/lib/sync/engine';

import { bootStore } from './boot';
import { store$ } from './collections';
import { isStoreHydrated, whenHydrated } from './persistence';

/**
 * Gates the app on local persistence being loaded.
 *
 * Until every persisted collection has hydrated into `store$` (and the implicit
 * local household exists), nothing downstream may read the collections — they
 * would see their empty defaults. While loading we render a static
 * splash-coloured view; the animated splash overlay (mounted alongside the
 * navigator once children render) then plays its reveal. Hydration is a set of
 * local kv-store reads, so this is effectively instant after the first launch.
 *
 * Migrations + defaults run via the shared, idempotent `bootStore()` (see
 * `./boot`) so the same upgrade-then-seed sequence is guaranteed to finish before
 * either a screen or the sync engine reads the collections. If it throws, we show
 * the recoverable error boundary with a retry rather than wedging on the splash.
 *
 * Cloud sync is attached separately, by `SessionProvider`, once the user signs
 * in — see `connectCollections()` in `@/lib/sync/engine`.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const hydrated = useValue(isStoreHydrated);
  const householdId = useValue(store$.meta.localHouseholdId);
  const [bootError, setBootError] = useState<unknown>(null);

  const runBoot = useCallback(() => {
    whenHydrated
      .then(() => {
        try {
          bootStore();
          // Track edits into the sync outbox from the very first write, signed in
          // or not, so a delete made while signed out still reaches the server.
          ensureChangeTracking();
          setBootError(null);
        } catch (error) {
          setBootError(error);
        }
      })
      .catch(setBootError);
  }, []);

  useEffect(() => {
    runBoot();
  }, [runBoot]);

  if (bootError) {
    const error = bootError instanceof Error ? bootError : new Error(String(bootError));
    return (
      <AppErrorBoundary
        error={error}
        retry={async () => {
          runBoot();
        }}
      />
    );
  }

  if (!hydrated || !householdId) {
    return <View style={styles.splash} />;
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({
  splash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#208AEF',
  },
});
