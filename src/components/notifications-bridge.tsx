import { useValue } from '@legendapp/state/react';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useMembers } from '@/lib/api/members';
import { useSession } from '@/lib/auth/session';
import {
  configureNotifications,
  notificationPermission$,
  notificationsSupported,
  offerNotificationsOnce,
  openNotification,
  refreshNotificationPermission,
  registerPushToken,
  syncReminders,
} from '@/lib/notifications/native';
import { store$ } from '@/lib/store/collections';
import { useLocale } from '@/lib/store/settings';
import { syncAuthRevision$ } from '@/lib/sync/auth-bridge';

/** Re-register the push token on return to the front at most this often. */
const REREGISTER_MS = 60 * 60_000;
/** After a failed registration, try again on return to the front, but not more often than this. */
const REREGISTER_RETRY_MS = 60_000;
/** Let the first screen settle before offering notifications. */
const OFFER_DELAY_MS = 2500;
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
  // Registering needs the authorized request the session installs for sync.
  // It is installed in the session's own effect, which runs after this
  // component's, so wait for it here rather than on `user`: each new
  // revision (launch, sign-in, account switch) registers again.
  const authRevision = useValue(syncAuthRevision$);
  const hasHousehold = isAuthenticated && !!user?.current_household;
  const canPush = hasHousehold && authRevision > 0;
  const userId = user?.id;
  const offered = useValue(store$.settings.notificationsOffered);
  const mayOffer = notificationsSupported && hasHousehold && permission === 'undetermined' && !offered;
  const members = useMembers(mayOffer);
  const shared = (members.data?.length ?? 0) > 1;

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
    let active = true;
    // Only a registration the server accepted counts; a failed one is retried
    // on the next return to the front.
    let registeredAt = 0;
    let attemptedAt = 0;
    const register = () => {
      attemptedAt = Date.now();
      void registerPushToken().then((ok) => {
        if (ok && active) registeredAt = Date.now();
      });
    };
    register();
    const tokenSubscription = Notifications.addPushTokenListener(register);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const now = Date.now();
      const due = registeredAt > 0 ? now - registeredAt >= REREGISTER_MS : now - attemptedAt >= REREGISTER_RETRY_MS;
      if (due) register();
    });
    return () => {
      active = false;
      tokenSubscription.remove();
      appStateSubscription.remove();
    };
  }, [canPush, permission, userId, authRevision]);

  // Someone already in a shared household was never asked (the prompt
  // follows sending or accepting an invite): offer it once.
  useEffect(() => {
    if (!mayOffer || !shared) return;
    const timer = setTimeout(() => {
      if (AppState.currentState === 'active') void offerNotificationsOnce(locale);
    }, OFFER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [mayOffer, shared, locale]);

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
