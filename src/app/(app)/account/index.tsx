import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert } from 'react-native';

import { useDeferredTab } from '@/hooks/use-deferred-tab';
import { AiSettingsSection } from '@/components/ai-settings';
import { AccountSetupCard } from '@/components/account-setup-card';
import { IngredientExclusions } from '@/components/ingredient-exclusions';
import { Badge } from '@/components/badge';
import { OptionGroup, type Option } from '@/components/option-group';
import { Screen } from '@/components/screen';
import { SettingsGroup, SettingsRow, SettingsSection } from '@/components/settings-list';
import { Stepper } from '@/components/stepper';
import { SyncIndicator } from '@/components/sync-indicator';
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
  setShoppingListDensity,
  useHouseholdDefaultServings,
  useLocale,
  useThemePreference,
  useShoppingListDensity,
  type ShoppingListDensity,
  type ThemePreference,
} from '@/lib/store';
import { flushPendingChanges } from '@/lib/sync/engine';
import { flushPersistence } from '@/lib/store/persistence';

function roleTone(role: HouseholdRole) {
  return role === 'owner' ? 'brand' : 'neutral';
}

/** Built when the tab is first shown, or once launch has settled — see `useDeferredTab`. */
export default function AccountScreen() {
  return useDeferredTab() ? <AccountScreenContent /> : null;
}

function AccountScreenContent() {
  const t = useT();
  const { user, signOut, refreshUser, isAuthenticated } = useSession();
  const { household, role, isOwner } = useActiveHousehold();

  const themePreference = useThemePreference();
  const shoppingListDensity = useShoppingListDensity();
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
        // No `finally`: the React Compiler can't lower it and would skip this
        // (always mounted) screen. The catch swallows every error anyway.
        try {
          await signOut();
          clearLocalData();
          await flushPersistence();
        } catch {
          Alert.alert(t('account.clearFailedTitle'), t('account.clearFailedMessage'));
        }
        setClearingData(false);
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
    // Best effort: get unsynced edits to the account before detaching. They
    // stay queued on the device either way, but only this account can upload
    // them — signing in as someone else afterwards would discard them.
    await flushPendingChanges()
      .catch(() => false)
      .then(() => signOut())
      .finally(() => setSigningOut(false));
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
  const densityOptions: Option<ShoppingListDensity>[] = [
    { value: 'standard', label: t('account.densityStandard'), hint: t('account.densityStandardHint') },
    { value: 'compact', label: t('account.densityCompact'), hint: t('account.densityCompactHint') },
  ];

  return (
    <Screen topInset={false}>
      {isAuthenticated ? (
        <SettingsSection
          title={t('household.sectionTitle')}
          footer={household && !isOwner ? t('household.onlyOwners') : undefined}>
          {household ? (
            <SettingsGroup>
              <SettingsRow
                icon={{ ios: 'house.fill', android: 'home', web: 'home' }}
                tone="brand"
                title={household.name}
                trailing={
                  role ? (
                    <Badge
                      label={role === 'owner' ? t('common.owner') : t('common.member')}
                      tone={roleTone(role)}
                    />
                  ) : null
                }
              />
              {isOwner ? (
                <SettingsRow
                  icon={{ ios: 'person.badge.plus', android: 'person_add', web: 'person_add' }}
                  title={t('household.invitePeople')}
                  onPress={() => pushOnce('/account/invite')}
                />
              ) : null}
              <SettingsRow
                icon={{ ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' }}
                title={t('household.manage')}
                onPress={() => pushOnce('/account/households')}
              />
            </SettingsGroup>
          ) : (
            <AccountSetupCard />
          )}
        </SettingsSection>
      ) : (
        <SettingsSection title={t('account.dataTitle')} footer={t('account.dataLocal')}>
          <SettingsGroup>
            <SettingsRow
              icon={{ ios: 'icloud.fill', android: 'cloud', web: 'cloud' }}
              tone="brand"
              title={t('account.connect')}
              onPress={() => pushOnce('/sign-in')}
            />
          </SettingsGroup>
        </SettingsSection>
      )}

      <SettingsSection title={t('account.appearance')}>
        <OptionGroup options={themeOptions} value={themePreference} onChange={onThemeChange} />
      </SettingsSection>

      <SettingsSection title={t('account.language')}>
        <OptionGroup options={localeOptions} value={locale} onChange={onLocaleChange} />
      </SettingsSection>

      <SettingsSection title={t('account.shoppingListDensity')} footer={t('account.shoppingListDensityHint')}>
        <OptionGroup options={densityOptions} value={shoppingListDensity} onChange={setShoppingListDensity} />
      </SettingsSection>

      <SettingsSection
        title={t('account.defaultServings')}
        footer={t('account.defaultServingsHint')}>
        <Stepper
          value={defaultServings}
          onChange={onDefaultServingsChange}
          min={1}
          max={99}
          accessibilityLabel={t('account.defaultServings')}
        />
      </SettingsSection>

      <AiSettingsSection />
      <SettingsSection title={t('ingredientExclusions.section')}>
        <IngredientExclusions />
      </SettingsSection>

      {isAuthenticated ? (
        <SettingsSection title={t('account.accountSection')}>
          <SettingsGroup>
            <SettingsRow
              icon={{ ios: 'person.fill', android: 'person', web: 'person' }}
              title={user?.email ?? '—'}
              subtitle={t('account.signedInAs')}>
              <SyncIndicator />
            </SettingsRow>
            <SettingsRow
              icon={{
                ios: 'rectangle.portrait.and.arrow.right',
                android: 'logout',
                web: 'logout',
              }}
              title={t('account.signOut')}
              accessory="none"
              loading={signingOut}
              onPress={onSignOut}
            />
          </SettingsGroup>
        </SettingsSection>
      ) : null}

      {PRIVACY_URL || SUPPORT_URL ? (
        <SettingsSection title={t('account.helpSection')}>
          <SettingsGroup>
            {SUPPORT_URL ? (
              <SettingsRow
                icon={{ ios: 'questionmark.circle.fill', android: 'help', web: 'help' }}
                title={t('account.support')}
                accessory="external"
                onPress={() => openPage(SUPPORT_URL)}
              />
            ) : null}
            {PRIVACY_URL ? (
              <SettingsRow
                icon={{ ios: 'hand.raised.fill', android: 'privacy_tip', web: 'privacy_tip' }}
                title={t('account.privacyPolicy')}
                accessory="external"
                onPress={() => openPage(PRIVACY_URL)}
              />
            ) : null}
          </SettingsGroup>
        </SettingsSection>
      ) : null}

      {/* Destructive actions live apart from everything else, at the very bottom. */}
      <SettingsSection
        title={t('account.dangerSection')}
        footer={isAuthenticated ? t('account.deleteAccountHint') : undefined}>
        <SettingsGroup>
          <SettingsRow
            icon={{ ios: 'trash.fill', android: 'delete', web: 'delete' }}
            tone="danger"
            title={t('account.clearDeviceData')}
            accessory="none"
            loading={clearingData}
            onPress={onClearDeviceData}
          />
          {isAuthenticated ? (
            <SettingsRow
              icon={{
                ios: 'person.crop.circle.badge.xmark',
                android: 'person_remove',
                web: 'person_remove',
              }}
              tone="danger"
              title={t('account.deleteAccount')}
              accessory="external"
              onPress={onDeleteAccount}
            />
          ) : null}
        </SettingsGroup>
      </SettingsSection>
    </Screen>
  );
}
