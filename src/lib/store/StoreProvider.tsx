import { useValue } from '@legendapp/state/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppErrorBoundary } from '@/components/error-boundary';
import { Colors } from '@/constants/theme';
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
/**
 * Run the boot sequence, returning the error instead of throwing. Idempotent
 * (`bootStore` latches), so a retry or a second caller is a cheap no-op.
 */
function tryBoot(): unknown {
  try {
    bootStore();
    // Track edits into the sync outbox from the very first write, signed in
    // or not, so a delete made while signed out still reaches the server.
    ensureChangeTracking();
    return null;
  } catch (error) {
    return error;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const hydrated = useValue(isStoreHydrated);
  // Hydration is synchronous with the SQLite plugin, so on a normal launch the
  // store is loaded by the time this first renders: boot (migrations, seeding)
  // runs right here, before any child can read an un-migrated row. The effect
  // below covers a plugin that loads asynchronously.
  const [bootError, setBootError] = useState<unknown>(() => (hydrated ? tryBoot() : null));
  const householdId = useValue(store$.meta.localHouseholdId);

  const runBoot = useCallback(() => {
    whenHydrated.then(() => setBootError(tryBoot())).catch(setBootError);
  }, []);

  useEffect(() => {
    if (!hydrated) runBoot();
  }, [hydrated, runBoot]);

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
    backgroundColor: Colors.light.accent,
  },
});
