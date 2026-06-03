import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useResolvedScheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/auth/session';
import { useT, type TFunction } from '@/lib/i18n';
import { syncNow } from '@/lib/sync/engine';
import { useSyncStatus } from '@/lib/sync/status';

/** How long the "Synced" confirmation lingers before fading out. */
const SYNCED_FLASH_MS = 1800;

const COLORS = {
  syncing: '#208AEF',
  synced: '#2e9b5b',
  pending: '#e5a23d',
  error: '#e5484d',
} as const;

type Pill = { label: string; color: string; busy: boolean; onPress?: () => void } | null;

/**
 * A subtle, app-wide sync status pill that floats below the status bar across
 * all tabs. Its job is confidence that your changes reached the server (so the
 * rest of the household pulls them): it flashes "Syncing… → Synced" when you
 * make changes, shows a quiet amber "Waiting to sync" while offline, and a
 * tappable red "Sync failed" on error. When everything is synced it shows
 * nothing.
 */
export function GlobalSyncBanner() {
  const t = useT();
  const { isAuthenticated } = useSession();
  const status = useSyncStatus();
  const insets = useSafeAreaInsets();
  const colors = Colors[useResolvedScheme()];

  // Briefly show "Synced" after a sync that pushed something completes.
  const [showSynced, setShowSynced] = useState(false);
  const prevPhase = useRef(status.phase);
  useEffect(() => {
    const finishedSyncing =
      prevPhase.current === 'syncing' && status.phase === 'idle' && !status.error;
    prevPhase.current = status.phase;
    if (!finishedSyncing) return;
    setShowSynced(true);
    const timer = setTimeout(() => setShowSynced(false), SYNCED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [status.phase, status.error]);

  if (!isAuthenticated) return null;

  const pill = describe(t, status, showSynced);
  if (!pill) return null;

  const body = (
    <View style={[styles.pill, { backgroundColor: colors.backgroundElement }]}>
      {pill.busy ? (
        <ActivityIndicator size="small" color={pill.color} />
      ) : (
        <View style={[styles.dot, { backgroundColor: pill.color }]} />
      )}
      <ThemedText type="small">{pill.label}</ThemedText>
    </View>
  );

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + Spacing.two }]}>
      {pill.onPress ? (
        <Pressable onPress={pill.onPress} accessibilityRole="button">
          {body}
        </Pressable>
      ) : (
        body
      )}
    </View>
  );
}

function describe(
  t: TFunction,
  status: ReturnType<typeof useSyncStatus>,
  showSynced: boolean,
): Pill {
  if (status.phase === 'syncing') {
    return { label: t('sync.syncing'), color: COLORS.syncing, busy: true };
  }
  if (status.phase === 'error') {
    return { label: t('sync.failedRetry'), color: COLORS.error, busy: false, onPress: syncNow };
  }
  if (status.pending > 0) {
    return { label: t('sync.waitingToSync'), color: COLORS.pending, busy: false };
  }
  if (showSynced) {
    return { label: t('sync.synced'), color: COLORS.synced, busy: false };
  }
  return null;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    // A soft lift so the pill reads as an overlay above content.
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
