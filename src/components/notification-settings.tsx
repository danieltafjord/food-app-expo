import { useValue } from '@legendapp/state/react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  type NotificationTopic,
} from '@/lib/api/notifications';
import { useSession } from '@/lib/auth/session';
import { useT, type TKey } from '@/lib/i18n';
import {
  notificationPermission$,
  notificationsSupported,
  requestNotificationPermission,
  setReminderSettings,
} from '@/lib/notifications/native';
import { DEFAULT_REMINDERS, DINNER_REMINDER_TIMES, type ReminderSettings } from '@/lib/notifications/reminder-settings';
import { store$ } from '@/lib/store/collections';

const TOPICS: { topic: NotificationTopic; label: TKey }[] = [
  { topic: 'list_items', label: 'notifications.listItems' },
  { topic: 'shopping', label: 'notifications.shopping' },
  { topic: 'plan', label: 'notifications.plan' },
  { topic: 'household', label: 'notifications.household' },
];

/**
 * Settings for notifications: the system permission, the local reminders
 * (this device only, no account needed), and which household activity the
 * account is pushed. Turning anything on asks for the permission first.
 */
export function NotificationSettingsSection() {
  const t = useT();
  const theme = useTheme();
  const permission = useValue(notificationPermission$);
  const storedReminders = useValue(store$.settings.reminders);
  const reminders: ReminderSettings = { ...DEFAULT_REMINDERS, ...storedReminders };
  const { isAuthenticated, user } = useSession();
  const preferences = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const allowed = permission === 'granted';

  if (!notificationsSupported) return null;

  async function ensureAllowed(): Promise<boolean> {
    return allowed || requestNotificationPermission();
  }

  async function changeReminder(change: Partial<ReminderSettings>) {
    if ((change.dinner || change.planWeek) && !(await ensureAllowed())) return;
    setReminderSettings(change);
  }

  async function changeTopic(topic: NotificationTopic, enabled: boolean) {
    if (enabled && !(await ensureAllowed())) return;
    update.mutate({ [topic]: enabled });
  }

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.title}>
        {t('notifications.section')}
      </ThemedText>
      <Card>
        {!allowed ? (
          <View style={styles.block}>
            <ThemedText type="small" themeColor="textSecondary">
              {t(permission === 'blocked' ? 'notifications.blocked' : 'notifications.off')}
            </ThemedText>
            <Button
              title={t(permission === 'blocked' ? 'notifications.openSettings' : 'notifications.turnOn')}
              size="small"
              variant="secondary"
              onPress={() => { void requestNotificationPermission(); }}
            />
          </View>
        ) : null}

        <ThemedText type="smallBold">{t('notifications.remindersTitle')}</ThemedText>
        <ToggleRow
          label={t('notifications.dinnerReminder')}
          hint={t('notifications.dinnerReminderHint')}
          value={allowed && reminders.dinner}
          onChange={(dinner) => { void changeReminder({ dinner }); }}
        />
        {allowed && reminders.dinner ? (
          <View style={styles.chips} accessibilityRole="radiogroup">
            {DINNER_REMINDER_TIMES.map((time) => {
              const selected = time === reminders.dinnerTime;
              return (
                <Pressable
                  key={time}
                  onPress={() => setReminderSettings({ dinnerTime: time })}
                  hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: selected ? theme.tint : theme.background,
                      borderColor: selected ? theme.tint : theme.border,
                    },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="small" style={selected ? { color: theme.onTint } : undefined}>{time}</ThemedText>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <ToggleRow
          label={t('notifications.planWeekReminder')}
          hint={t('notifications.planWeekReminderHint')}
          value={allowed && reminders.planWeek}
          onChange={(planWeek) => { void changeReminder({ planWeek }); }}
        />

        <ThemedText type="smallBold">{t('notifications.householdTitle')}</ThemedText>
        {!isAuthenticated || !user?.current_household ? (
          <ThemedText type="small" themeColor="textSecondary">{t('notifications.signIn')}</ThemedText>
        ) : preferences.data ? (
          TOPICS.map(({ topic, label }) => (
            <ToggleRow
              key={topic}
              label={t(label)}
              value={allowed && preferences.data[topic]}
              disabled={update.isPending}
              onChange={(enabled) => { void changeTopic(topic, enabled); }}
            />
          ))
        ) : preferences.isError ? (
          <Button title={t('error.retry')} variant="secondary" size="small" onPress={() => { void preferences.refetch(); }} />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">{t('notifications.loading')}</ThemedText>
        )}
        {update.isError ? (
          <ThemedText type="small" style={{ color: theme.danger }}>{t('notifications.saveFailed')}</ThemedText>
        ) : null}
      </Card>
    </View>
  );
}

function ToggleRow({ label, hint, value, disabled, onChange }: {
  label: string;
  hint?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.label}>
        <ThemedText type="small">{label}</ThemedText>
        {hint ? <ThemedText type="small" themeColor="textSecondary">{hint}</ThemedText> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: theme.accent }}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  title: { paddingHorizontal: Spacing.one },
  block: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  label: { flex: 1, gap: Spacing.half },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.6 },
});
