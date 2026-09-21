import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AiSettingsSection } from '@/components/ai-settings';
import { AccountSetupCard } from '@/components/account-setup-card';
import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { OptionGroup, type Option } from '@/components/option-group';
import { Screen } from '@/components/screen';
import { Stepper } from '@/components/stepper';
import { SyncIndicator } from '@/components/sync-indicator';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useActiveHousehold, useUpdateHousehold } from '@/lib/api/households';
import { useUpdateSettings } from '@/lib/api/settings';
import type { HouseholdRole } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { API_BASE_URL, PRIVACY_URL, SUPPORT_URL } from '@/lib/config';
import { LOCALE_LABELS, LOCALES, useT, type Locale } from '@/lib/i18n';
import { pushOnce } from '@/lib/navigation';
import {
  clearLocalData,
  setHouseholdDefaultServings,
  setLocale,
  setThemePreference,
  useHouseholdDefaultServings,
  useLocale,
  useThemePreference,
  type ThemePreference,
} from '@/lib/store';
import { flushPendingChanges } from '@/lib/sync/engine';
import { flushPersistence } from '@/lib/store/persistence';

function roleTone(role: HouseholdRole) {
  return role === 'owner' ? 'brand' : 'neutral';
}

export default function AccountScreen() {
  const t = useT();
  const { user, signOut, refreshUser, isAuthenticated } = useSession();
  const { household, role, isOwner } = useActiveHousehold();

  const themePreference = useThemePreference();
  const locale = useLocale();
  const defaultServings = useHouseholdDefaultServings();
  const updateSettings = useUpdateSettings();
  const updateHousehold = useUpdateHousehold();

  const [signingOut, setSigningOut] = useState(false);
  const [clearingData, setClearingData] = useState(false);

  function onClearDeviceData() {
    Alert.alert(t('account.clearDeviceData'), t('account.clearDeviceDataHint'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('account.clearDeviceData'), style: 'destructive', onPress: async () => {
        setClearingData(true);
        try {
          await signOut();
          clearLocalData();
          await flushPersistence();
        } catch {
          Alert.alert(t('account.clearFailedTitle'), t('account.clearFailedMessage'));
        } finally {
          setClearingData(false);
        }
      } },
    ]);
  }

  // The change already landed locally (local-first), so the mirror to the server
  // is best-effort — but a silent failure would leave this device and the account
  // disagreeing, so surface it and let the user retry.
  function notifySyncFailure() {
    Alert.alert(t('account.syncFailedTitle'), t('account.syncFailedMessage'));
  }

  // Apply locally first (instant), then mirror to the account when signed in.
  function onThemeChange(next: ThemePreference) {
    setThemePreference(next);
    if (isAuthenticated) {
      updateSettings.mutate({ theme: next, locale }, { onError: notifySyncFailure });
    }
  }

  function onLocaleChange(next: Locale) {
    setLocale(next);
    if (isAuthenticated) {
      updateSettings.mutate({ theme: themePreference, locale: next }, { onError: notifySyncFailure });
    }
  }

  // Apply locally first (instant + offline), then mirror to the shared server
  // household so the rest of the household picks it up. The Stepper clamps the
  // value, so `next` is already within range.
  function onDefaultServingsChange(next: number) {
    setHouseholdDefaultServings(next);
    if (isAuthenticated && household) {
      updateHousehold.mutate(
        { id: household.id, name: household.name, default_servings: next },
        { onError: notifySyncFailure },
      );
    }
  }

  async function onSignOut() {
    setSigningOut(true);
    try {
      // Best effort: get unsynced edits to the account before detaching. They
      // stay queued on the device either way, but only this account can upload
      // them — signing in as someone else afterwards would discard them.
      await flushPendingChanges().catch(() => false);
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  // Deletion lives on the web profile page (it needs a password confirmation the
  // token-based API can't do). Once the browser closes, re-fetch `/me`: a deleted
  // account answers 401, which clears the session like any other revoked token.
  async function openPage(url: string) {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert(t('account.linkFailedTitle'), t('account.linkFailedMessage'));
    }
  }

  async function onDeleteAccount() {
    await openPage(`${API_BASE_URL}/settings/profile`);
    await refreshUser().catch(() => {});
  }

  const themeOptions: Option<ThemePreference>[] = [
    { value: 'system', label: t('account.themeSystem'), hint: t('account.themeSystemHint') },
    { value: 'light', label: t('account.themeLight') },
    { value: 'dark', label: t('account.themeDark') },
  ];
  const localeOptions: Option<Locale>[] = LOCALES.map((value) => ({
    value,
    label: LOCALE_LABELS[value],
  }));

  return (
    <Screen topInset={false}>
      <View style={styles.section}>
        <ThemedText type="smallBold">{t('account.appearance')}</ThemedText>
        <OptionGroup options={themeOptions} value={themePreference} onChange={onThemeChange} />
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">{t('account.language')}</ThemedText>
        <OptionGroup options={localeOptions} value={locale} onChange={onLocaleChange} />
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">{t('account.defaultServings')}</ThemedText>
        <Stepper
          value={defaultServings}
          onChange={onDefaultServingsChange}
          min={1}
          max={99}
          accessibilityLabel={t('account.defaultServings')}
        />
        <ThemedText type="small" themeColor="textSecondary">
          {t('account.defaultServingsHint')}
        </ThemedText>
      </View>

      <AiSettingsSection />

      {isAuthenticated ? (
        <>
          <View style={styles.section}>
            <ThemedText type="smallBold">{t('household.sectionTitle')}</ThemedText>
            {household ? (
              <Card>
                <View style={styles.rowBetween}>
                  <ThemedText type="subtitle" style={styles.flex}>
                    {household.name}
                  </ThemedText>
                  {role ? (
                    <Badge
                      label={role === 'owner' ? t('common.owner') : t('common.member')}
                      tone={roleTone(role)}
                    />
                  ) : null}
                </View>
                {isOwner ? (
                  <Button
                    title={t('household.invitePeople')}
                    variant="secondary"
                    size="small"
                    onPress={() => pushOnce('/account/invite')}
                  />
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('household.onlyOwners')}
                  </ThemedText>
                )}
                <Button
                  title={t('household.manage')}
                  variant="secondary"
                  onPress={() => pushOnce('/account/households')}
                />
              </Card>
            ) : (
              <AccountSetupCard />
            )}
          </View>

          <View style={styles.section}>
            <ThemedText type="smallBold">{t('account.accountSection')}</ThemedText>
            <Card>
              <View style={styles.rowBetween}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('account.signedInAs')}
                </ThemedText>
                <ThemedText type="small" style={styles.flexEnd}>
                  {user?.email ?? '—'}
                </ThemedText>
              </View>
              <SyncIndicator />
            </Card>
            <Button
              title={t('account.signOut')}
              variant="secondary"
              loading={signingOut}
              onPress={onSignOut}
            />
            <Button title={t('account.deleteAccount')} variant="danger" onPress={onDeleteAccount} />
            <ThemedText type="small" themeColor="textSecondary">
              {t('account.deleteAccountHint')}
            </ThemedText>
          </View>
        </>
      ) : (
        <View style={styles.section}>
          <ThemedText type="smallBold">{t('account.dataTitle')}</ThemedText>
          <Card>
            <ThemedText type="small" themeColor="textSecondary">
              {t('account.dataLocal')}
            </ThemedText>
            <Button title={t('account.connect')} onPress={() => pushOnce('/sign-in')} />
          </Card>
        </View>
      )}
      <Button title={t('account.clearDeviceData')} variant="danger" loading={clearingData} onPress={onClearDeviceData} />
      {(PRIVACY_URL || SUPPORT_URL) ? (
        <View style={styles.section}>
          {PRIVACY_URL ? <Button title={t('account.privacyPolicy')} variant="secondary" onPress={() => openPage(PRIVACY_URL)} /> : null}
          {SUPPORT_URL ? <Button title={t('account.support')} variant="secondary" onPress={() => openPage(SUPPORT_URL)} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  flex: {
    flexShrink: 1,
  },
  flexEnd: {
    flexShrink: 1,
    textAlign: 'right',
  },
});
