import { syncState } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { store$ } from './collections';
import { ensureLocalHousehold } from './household';
import { whenHydrated } from './persistence';
import { ensureSettingsDefaults } from './settings';

/**
 * Gates the app on local persistence being loaded.
 *
 * Until the persisted state has hydrated into `store$` (and the implicit local
 * household exists), nothing downstream may read the collections — they would
 * see their empty defaults. While loading we render a static splash-coloured
 * view; the animated splash overlay (mounted alongside the navigator once
 * children render) then plays its reveal. Hydration is a local kv-store read,
 * so this is effectively instant after the first launch.
 *
 * Cloud sync is attached separately, by `SessionProvider`, once the user signs
 * in — see `connectCollections()` in `@/lib/sync/engine`.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const hydrated = useValue(syncState(store$).isPersistLoaded);
  const householdId = useValue(store$.meta.localHouseholdId);

  useEffect(() => {
    whenHydrated.then(() => {
      ensureLocalHousehold();
      ensureSettingsDefaults();
    });
  }, []);

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
