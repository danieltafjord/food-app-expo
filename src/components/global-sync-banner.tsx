import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { showSyncFailures } from '@/components/sync-failures';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/auth/session';
import { useT, type TFunction } from '@/lib/i18n';
import { syncNow } from '@/lib/sync/engine';
import { useSyncStatus, type SyncStatus } from '@/lib/sync/status';

type Tone = 'neutral' | 'danger';

type Pill = { label: string; tone: Tone; busy: boolean; onPress?: () => void } | null;

/**
 * An app-wide sync status pill, floating just above the tab bar on every tab
 * — clear of the screens' headers, and out of the way of touches unless it
 * offers something to tap.
 *
 * Silent while things work: routine syncs after an edit show nothing (sync
 * is the normal state, not news). It appears for the first download of a
 * household, a calm neutral "Offline" while changes wait for a connection,
 * and a tappable notice when something needs the user.
 */
export function GlobalSyncBanner() {
  const t = useT();
  const theme = useTheme();
  const { isAuthenticated, setupPhase, retrySetup } = useSession();
  const status = useSyncStatus();

  if (!isAuthenticated) return null;

  const pill: Pill = setupPhase === 'setting-up'
    ? { label: t('sync.settingUp'), tone: 'neutral', busy: true }
    : setupPhase === 'offline'
      ? { label: t('sync.offline'), tone: 'neutral', busy: false }
      : setupPhase === 'error'
        ? { label: t('sync.setupFailedRetry'), tone: 'danger', busy: false, onPress: retrySetup }
        : setupPhase === 'invitation'
          ? null
          : describe(t, status);
  if (!pill) return null;

  const color = pill.tone === 'danger' ? theme.danger : theme.textSecondary;
  const body = (
    <View style={[styles.pill, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {pill.busy ? (
        <ActivityIndicator size="small" color={color} style={styles.spinner} />
      ) : (
        <View style={[styles.dot, { backgroundColor: color }]} />
      )}
      <ThemedText type="small" themeColor={pill.tone === 'danger' ? 'text' : 'textSecondary'} numberOfLines={1} style={styles.label}>
        {pill.label}
      </ThemedText>
    </View>
  );

  return (
    <View pointerEvents={pill.onPress ? 'box-none' : 'none'} style={styles.host}>
      {pill.onPress ? (
        <Pressable onPress={pill.onPress} accessibilityRole="button" hitSlop={8}>
          {body}
        </Pressable>
      ) : (
        <View accessibilityLiveRegion="polite">{body}</View>
      )}
    </View>
  );
}

function describe(t: TFunction, status: SyncStatus): Pill {
  if (status.phase === 'error') {
    switch (status.error) {
      case 'householdChanged':
        return { label: t('sync.householdChanged'), tone: 'danger', busy: false, onPress: syncNow };
      case 'householdGone':
        return { label: t('sync.householdGone'), tone: 'danger', busy: false, onPress: syncNow };
      default:
        return { label: t('sync.failedRetry'), tone: 'danger', busy: false, onPress: syncNow };
    }
  }
  if (status.rejected > 0) {
    return { label: t(status.rejected === 1 ? 'sync.rejectedCountOne' : 'sync.rejectedCount', { count: status.rejected }), tone: 'danger',
      busy: false, onPress: () => showSyncFailures(t) };
  }
  // Only the first download is worth watching; routine syncs stay silent.
  if (status.phase === 'syncing' && status.firstSync) {
    return { label: t('sync.syncing'), tone: 'neutral', busy: true };
  }
  if (status.phase === 'offline' && status.pending > 0) {
    return { label: t('sync.offline'), tone: 'neutral', busy: false };
  }
  return null;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: BottomTabInset + Spacing.two,
    alignItems: 'center',
  },
  pill: {
    // Narrow enough to stay clear of the bottom-right add button.
    maxWidth: '60%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    flexShrink: 1,
  },
  spinner: {
    transform: [{ scale: 0.7 }],
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
