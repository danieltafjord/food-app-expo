import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth/session';
import { relativeTime } from '@/lib/format';
import { useT, type TFunction } from '@/lib/i18n';
import { useSyncStatus, type SyncStatus } from '@/lib/sync/status';

const COLORS = {
  local: '#9aa0a6',
  syncing: '#208AEF',
  synced: '#2e9b5b',
  pending: '#e5a23d',
  error: '#e5484d',
} as const;

type Display = { label: string; detail: string | null; color: string; busy: boolean };

function describe(t: TFunction, isAuthenticated: boolean, status: SyncStatus): Display {
  // No account → purely on-device; nothing syncs.
  if (!isAuthenticated) {
    return {
      label: t('sync.onThisDevice'),
      detail: t('sync.notSynced'),
      color: COLORS.local,
      busy: false,
    };
  }
  switch (status.phase) {
    case 'syncing':
      return { label: t('sync.syncing'), detail: null, color: COLORS.syncing, busy: true };
    case 'error':
      return {
        label: t('sync.syncError'),
        detail: status.error ?? t('sync.willRetry'),
        color: COLORS.error,
        busy: false,
      };
    case 'idle':
    default:
      if (status.pending > 0) {
        return {
          label: t('sync.pending'),
          detail: t('sync.pendingCount', { count: status.pending }),
          color: COLORS.pending,
          busy: false,
        };
      }
      if (status.lastSyncedAt) {
        return {
          label: t('sync.synced'),
          detail: relativeTime(status.lastSyncedAt),
          color: COLORS.synced,
          busy: false,
        };
      }
      // Connected, but the sync engine isn't live yet (Phase 1).
      return {
        label: t('sync.connected'),
        detail: t('sync.syncSoon'),
        color: COLORS.pending,
        busy: false,
      };
  }
}

/**
 * Compact connection/sync status. Self-contained (reads its own state), so it
 * can sit in Settings now and be dropped into a global banner later. Today it
 * reflects local vs connected; in Phase 2 the same `syncStatus$` drives the
 * live "Syncing…/Synced/Error" states.
 */
export function SyncIndicator() {
  const t = useT();
  const { isAuthenticated } = useSession();
  const status = useSyncStatus();
  const d = describe(t, isAuthenticated, status);

  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={t('sync.statusLabel', {
        status: `${d.label}${d.detail ? `, ${d.detail}` : ''}`,
      })}>
      <View style={styles.icon}>
        {d.busy ? (
          <ActivityIndicator size="small" color={d.color} />
        ) : (
          <View style={[styles.dot, { backgroundColor: d.color }]} />
        )}
      </View>
      <ThemedText type="small">{d.label}</ThemedText>
      {d.detail ? (
        <ThemedText type="small" themeColor="textSecondary">
          · {d.detail}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  icon: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
