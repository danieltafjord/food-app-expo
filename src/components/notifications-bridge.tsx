import { useValue } from '@legendapp/state/react';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useSession } from '@/lib/auth/session';
import {
  configureNotifications,
  notificationPermission$,
  notificationsSupported,
  openNotification,
  refreshNotificationPermission,
  registerPushToken,
  syncReminders,
} from '@/lib/notifications/native';
import { store$ } from '@/lib/store/collections';
import { useLocale } from '@/lib/store/settings';

/** Re-register the push token on return to the front at most this often. */
const REREGISTER_MS = 60 * 60_000;
/** Plan edits come in bursts (a week planned at once); reschedule once they settle. */
const RESCHEDULE_DEBOUNCE_MS = 1500;

/**
 * Keeps notifications wired up while the app runs: the permission, this
 * install's push token on the account, what a tapped notification opens, and
 * the local reminders following the plan. Renders nothing.
 *
 * Mounted inside the app's navigator, so a tap that launched the app can
 * navigate as soon as it mounts.
 */
export function NotificationsBridge() {
  const locale = useLocale();
  const { user, isAuthenticated } = useSession();
  const permission = useValue(notificationPermission$);
  const canPush = isAuthenticated && !!user?.current_household;
  const userId = user?.id;

  useEffect(() => {
    configureNotifications(locale);
  }, [locale]);

  useEffect(() => {
    if (!notificationsSupported) return;
    void refreshNotificationPermission();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshNotificationPermission();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!notificationsSupported) return;
    const launch = Notifications.getLastNotificationResponse();
    if (launch) setTimeout(() => openNotification(launch), 0);
    const subscription = Notifications.addNotificationResponseReceivedListener(openNotification);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!notificationsSupported || !canPush || permission !== 'granted') return;
    let registeredAt = Date.now();
    void registerPushToken();
    const tokenSubscription = Notifications.addPushTokenListener(() => {
      registeredAt = Date.now();
      void registerPushToken();
    });
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || Date.now() - registeredAt < REREGISTER_MS) return;
      registeredAt = Date.now();
      void registerPushToken();
    });
    return () => {
      tokenSubscription.remove();
      appStateSubscription.remove();
    };
  }, [canPush, permission, userId]);

  useEffect(() => {
    if (!notificationsSupported) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reschedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void syncReminders(), RESCHEDULE_DEBOUNCE_MS);
    };
    reschedule();
    const disposers = [
      store$.planEntries.onChange(reschedule),
      store$.dinners.onChange(reschedule),
      store$.settings.reminders.onChange(reschedule),
    ];
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') reschedule();
    });
    return () => {
      clearTimeout(timer);
      disposers.forEach((dispose) => dispose());
      subscription.remove();
    };
  }, [locale, permission]);

  return null;
}
