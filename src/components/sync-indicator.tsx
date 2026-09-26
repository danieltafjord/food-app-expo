import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { showSyncFailures } from '@/components/sync-failures';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/auth/session';
import { relativeTime } from '@/lib/format';
import { useT, type TFunction } from '@/lib/i18n';
import { useSyncStatus, type SyncErrorCode, type SyncStatus } from '@/lib/sync/status';
import { syncNow } from '@/lib/sync/engine';

/**
 * Dot colours, from the theme: black-and-white for every normal state (solid
 * when synced, muted while waiting), `danger` only when the user must act.
 */
const COLORS = {
  local: 'textSecondary',
  syncing: 'textSecondary',
  synced: 'text',
  pending: 'textSecondary',
  error: 'danger',
} as const satisfies Record<string, ThemeColor>;

type Display = { label: string; detail: string | null; color: ThemeColor; busy: boolean };

function errorDetail(t: TFunction, error: SyncErrorCode | null): string {
  switch (error) {
    case 'householdChanged':
      return t('sync.householdChanged');
    case 'householdGone':
      return t('sync.householdGone');
    default:
      return t('sync.willRetry');
  }
}

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
        detail: errorDetail(t, status.error),
        color: COLORS.error,
        busy: false,
      };
    case 'offline':
      return {
        label: t('sync.offline'),
        detail: status.pending > 0 ? t('sync.pendingCount', { count: status.pending }) : null,
        color: COLORS.pending,
        busy: false,
      };
    case 'idle':
    default:
      if (status.rejected > 0) {
        return { label: t('sync.syncError'), detail: t(status.rejected === 1 ? 'sync.rejectedCountOne' : 'sync.rejectedCount', { count: status.rejected }), color: COLORS.error, busy: false };
      }
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
      // Account setup is complete; the first sync is starting.
      return {
        label: t('sync.connected'),
        detail: t('sync.syncing'),
        color: COLORS.syncing,
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
  const theme = useTheme();
  const { isAuthenticated, setupPhase, retrySetup } = useSession();
  const status = useSyncStatus();
  const d: Display = !isAuthenticated || setupPhase === 'ready'
    ? describe(t, isAuthenticated, status)
    : setupPhase === 'error'
      ? { label: t('sync.setupFailedRetry'), detail: null, color: COLORS.error, busy: false }
      : setupPhase === 'offline'
        ? { label: t('sync.offline'), detail: t('sync.setupWaiting'), color: COLORS.pending, busy: false }
        : setupPhase === 'invitation'
          ? { label: t('sync.onThisDevice'), detail: t('sync.finishInvitation'), color: COLORS.local, busy: false }
          : { label: t('sync.settingUp'), detail: null, color: COLORS.syncing, busy: true };
  const retry = isAuthenticated && setupPhase === 'error' ? retrySetup
    : isAuthenticated && status.rejected > 0 ? () => showSyncFailures(t)
      : isAuthenticated && status.phase === 'error' ? syncNow : undefined;

  return (
    <Pressable
      style={styles.row}
      onPress={retry}
      disabled={!retry}
      accessibilityRole={retry ? 'button' : 'text'}
      accessibilityLabel={t('sync.statusLabel', {
        status: `${d.label}${d.detail ? `, ${d.detail}` : ''}`,
      })}>
      <View style={styles.icon}>
        {d.busy ? (
          <ActivityIndicator size="small" color={theme[d.color]} />
        ) : (
          <View style={[styles.dot, { backgroundColor: theme[d.color] }]} />
        )}
      </View>
      <ThemedText type="small" style={styles.text}>{d.label}</ThemedText>
      {d.detail ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
          · {d.detail}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  text: {
    flexShrink: 1,
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
