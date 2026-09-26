import { observable } from '@legendapp/state';
import Constants from 'expo-constants';
import { getCalendars } from 'expo-localization';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { Alert, AppState, Linking, Platform } from 'react-native';

import { translate, type Locale } from '@/lib/i18n';
import { isInPresenceScope } from '@/lib/realtime/live';
import { store$ } from '@/lib/store/collections';
import { setPlannerWeekKey } from '@/lib/planner-state';
import { getLocale } from '@/lib/store/settings';
import { getSyncRequest } from '@/lib/sync/auth-bridge';
import { syncNow } from '@/lib/sync/engine';

import { DEFAULT_REMINDERS, type ReminderSettings } from './reminder-settings';
import { planReminders } from './reminders';

/**
 * Notifications on the device: permission, the Expo push token the server
 * sends household activity to, what a tap opens, and the local reminders.
 *
 * Push is for what other members do (see the backend's
 * SendHouseholdActivityNotifications); reminders are scheduled here from the
 * plan on this device. Nothing here runs on web.
 */

export const notificationsSupported = Platform.OS === 'ios' || Platform.OS === 'android';

export type NotificationPermission = 'granted' | 'undetermined' | 'denied' | 'blocked';

/** The current permission, kept fresh when the app returns to the front. */
export const notificationPermission$ = observable<NotificationPermission>('undetermined');

const REMINDER_PREFIX = 'reminder.';
const HOUSEHOLD_CHANNEL = 'household';
const REMINDER_CHANNEL = 'reminders';

/** The token this install last registered, sent along on sign-out so the server forgets it. */
let registeredToken: string | null = null;

export function getRegisteredPushToken(): string | null {
  return registeredToken;
}

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * This install's push token, for the sign-out request so the server stops
 * pushing the previous account's household here. After a cold start nothing
 * has registered yet, so it is asked for — only when notifications are
 * allowed (asking can't prompt then), and briefly: sign-out must not hang on it.
 */
export async function pushTokenForSignOut(timeoutMs = 2000): Promise<string | null> {
  if (registeredToken) return registeredToken;
  if (!notificationsSupported) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const lookup = (async () => {
      if (toPermission(await Notifications.getPermissionsAsync()) !== 'granted') return null;
      return (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
    })();
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    return await Promise.race([lookup, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ---- presentation -------------------------------------------------------- */

/**
 * Show notifications while the app is open too, except one about the screen
 * the user is already looking at: the live highlight shows that change.
 */
export function configureNotifications(locale: Locale): void {
  if (!notificationsSupported) return;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const scope = notification.request.content.data?.scope;
      const quiet = typeof scope === 'string' && AppState.currentState === 'active' && isInPresenceScope(scope);
      return { shouldShowBanner: !quiet, shouldShowList: !quiet, shouldPlaySound: !quiet, shouldSetBadge: false };
    },
  });
  void setChannels(locale);
}

/** Android channels, named in the app's language (renaming later updates them). */
export async function setChannels(locale: Locale): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(HOUSEHOLD_CHANNEL, {
    name: translate(locale, 'notifications.channelHousehold'),
    importance: Notifications.AndroidImportance.HIGH,
  }).catch(() => undefined);
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
    name: translate(locale, 'notifications.channelReminders'),
    importance: Notifications.AndroidImportance.DEFAULT,
  }).catch(() => undefined);
}

/* ---- permission ---------------------------------------------------------- */

function toPermission(status: Notifications.NotificationPermissionsStatus): NotificationPermission {
  if (status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  if (status.status === 'undetermined') return 'undetermined';
  return status.canAskAgain ? 'denied' : 'blocked';
}

export async function refreshNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported) return 'blocked';
  const permission = toPermission(await Notifications.getPermissionsAsync());
  notificationPermission$.set(permission);
  return permission;
}

/**
 * Ask for permission if the system still lets us, else open the app's system
 * settings. Resolves to whether notifications are allowed now.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported) return false;
  const current = await refreshNotificationPermission();
  if (current === 'granted') return true;
  if (current === 'blocked') {
    await Linking.openSettings().catch(() => undefined);
    return false;
  }
  const permission = toPermission(await Notifications.requestPermissionsAsync());
  notificationPermission$.set(permission);
  return permission === 'granted';
}

/**
 * Ask once, at a moment it makes sense (the household just became shared),
 * never again after the user has answered.
 */
export async function askForNotificationsOnce(): Promise<void> {
  if (!notificationsSupported) return;
  if ((await refreshNotificationPermission()) === 'undetermined') await requestNotificationPermission();
}

/**
 * Offer notifications once to someone whose household is already shared (they
 * were never asked: the prompt otherwise follows sending or accepting an
 * invite). A short explanation first, so the system prompt — which can only
 * be shown once — comes when the user said yes. Remembered on the device
 * whatever the answer, so it never nags.
 */
export async function offerNotificationsOnce(locale: Locale): Promise<void> {
  if (!notificationsSupported || store$.settings.notificationsOffered.peek()) return;
  if ((await refreshNotificationPermission()) !== 'undetermined') return;
  if (store$.settings.notificationsOffered.peek()) return;
  store$.settings.notificationsOffered.set(true);
  const accepted = await new Promise<boolean>((resolve) => {
    Alert.alert(
      translate(locale, 'notifications.primerTitle'),
      translate(locale, 'notifications.primerMessage'),
      [
        { text: translate(locale, 'notifications.primerLater'), style: 'cancel', onPress: () => resolve(false) },
        { text: translate(locale, 'notifications.primerAccept'), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
  if (accepted) await requestNotificationPermission();
}

/* ---- push token ---------------------------------------------------------- */

/**
 * Tell the server where to push for this install. Needs the permission and a
 * signed-in account with a household; a no-op otherwise. Safe to repeat: it
 * also refreshes the token's time zone and which session it belongs to.
 * Resolves to whether the server now has it.
 */
export async function registerPushToken(token?: string): Promise<boolean> {
  const request = getSyncRequest();
  if (!notificationsSupported || !request || notificationPermission$.peek() !== 'granted') return false;
  try {
    const pushToken = token ?? (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
    await request('/me/push-token', {
      method: 'PUT',
      body: { token: pushToken, platform: Platform.OS, timezone: getCalendars()[0]?.timeZone ?? null },
    });
    registeredToken = pushToken;
    return true;
  } catch {
    // Offline, a simulator without push, or an older server: retried on the next foreground.
    return false;
  }
}

/* ---- taps ---------------------------------------------------------------- */

const handledResponses = new Set<string>();

/** Open what a tapped notification is about: a shopping list, or a week of the plan. */
export function openNotification(response: Notifications.NotificationResponse): void {
  const { identifier, content } = response.notification.request;
  const key = `${identifier}|${response.notification.date}`;
  if (handledResponses.has(key)) return;
  handledResponses.add(key);

  const data = content.data ?? {};
  if (typeof data.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.week)) setPlannerWeekKey(data.week);
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';
  // The change may not have synced here yet.
  void syncNow().catch(() => undefined);
  router.navigate(url as Href);
}

/* ---- reminders ----------------------------------------------------------- */

export function getReminderSettings(): ReminderSettings {
  return { ...DEFAULT_REMINDERS, ...store$.settings.reminders.peek() };
}

export function setReminderSettings(next: Partial<ReminderSettings>): void {
  store$.settings.reminders.set({ ...getReminderSettings(), ...next });
}

/**
 * Bring the scheduled reminders in line with the plan and settings: cancel
 * those no longer wanted (or whose dinner changed), schedule the missing ones.
 */
export async function syncReminders(): Promise<void> {
  if (!notificationsSupported) return;
  const settings = getReminderSettings();
  const allowed = notificationPermission$.peek() === 'granted';
  const locale = getLocale();

  const wanted = allowed && (settings.dinner || settings.planWeek)
    ? planReminders({
      now: new Date(),
      settings,
      entries: Object.values(store$.planEntries.peek() ?? {}),
      dinnerName: (id) => store$.dinners[id].name.peek(),
      strings: {
        dinnerTitle: translate(locale, 'notifications.dinnerTitle'),
        planWeekTitle: translate(locale, 'notifications.planWeekTitle'),
        planWeekBody: translate(locale, 'notifications.planWeekBody'),
      },
    })
    : [];

  try {
    const scheduled = (await Notifications.getAllScheduledNotificationsAsync())
      .map((request) => request.identifier)
      .filter((id) => id.startsWith(REMINDER_PREFIX));
    const wantedIds = new Set(wanted.map((reminder) => `${REMINDER_PREFIX}${locale}.${reminder.id}`));
    await Promise.all(scheduled.filter((id) => !wantedIds.has(id)).map((id) => Notifications.cancelScheduledNotificationAsync(id)));
    for (const reminder of wanted) {
      const identifier = `${REMINDER_PREFIX}${locale}.${reminder.id}`;
      if (scheduled.includes(identifier)) continue;
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: { title: reminder.title, body: reminder.body, data: { url: '/', week: reminder.week }, sound: 'default' },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.at, channelId: REMINDER_CHANNEL },
      });
    }
  } catch {
    // Scheduling is retried on the next change or foreground.
  }
}
