import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { OptionGroup, type Option } from '@/components/option-group';
import { Screen } from '@/components/screen';
import { SyncIndicator } from '@/components/sync-indicator';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useActiveHousehold } from '@/lib/api/households';
import { useUpdateSettings } from '@/lib/api/settings';
import type { HouseholdRole } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { LOCALE_LABELS, LOCALES, useT, type Locale } from '@/lib/i18n';
import {
  setLocale,
  setThemePreference,
  useLocale,
  useLocalHousehold,
  useThemePreference,
  type ThemePreference,
} from '@/lib/store';

function roleTone(role: HouseholdRole) {
  return role === 'owner' ? 'brand' : 'neutral';
}

export default function AccountScreen() {
  const t = useT();
  const { user, signOut, isAuthenticated } = useSession();
  const localHousehold = useLocalHousehold();
  const { household, role, isOwner } = useActiveHousehold();

  const themePreference = useThemePreference();
  const locale = useLocale();
  const updateSettings = useUpdateSettings();

  const [signingOut, setSigningOut] = useState(false);

  // Apply locally first (instant), then mirror to the account when signed in.
  function onThemeChange(next: ThemePreference) {
    setThemePreference(next);
    if (isAuthenticated) {
      updateSettings.mutate({ theme: next, locale });
    }
  }

  function onLocaleChange(next: Locale) {
    setLocale(next);
    if (isAuthenticated) {
      updateSettings.mutate({ theme: themePreference, locale: next });
    }
  }

  async function onSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
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

      <Card>
        <ThemedText type="smallBold">{t('account.thisDevice')}</ThemedText>
        <View style={styles.rowBetween}>
          <ThemedText type="subtitle" style={styles.flex}>
            {localHousehold?.name ?? 'My Kitchen'}
          </ThemedText>
          <Badge label={t('account.onThisDevice')} tone="neutral" />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {t('account.deviceDescription')}
        </ThemedText>
        <SyncIndicator />
      </Card>

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
                    onPress={() => router.push('/account/invite')}
                  />
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('household.onlyOwners')}
                  </ThemedText>
                )}
                <Button
                  title={t('household.manage')}
                  variant="secondary"
                  onPress={() => router.push('/account/households')}
                />
              </Card>
            ) : (
              <Card>
                <ThemedText themeColor="textSecondary">
                  {t('household.noHouseholdDescription')}
                </ThemedText>
                <Button
                  title={t('household.createHousehold')}
                  onPress={() => router.push('/account/create')}
                />
                <Button
                  title={t('household.joinWithLink')}
                  variant="secondary"
                  onPress={() => router.push('/account/join')}
                />
              </Card>
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
            </Card>
            <Button
              title={t('account.signOut')}
              variant="secondary"
              loading={signingOut}
              onPress={onSignOut}
            />
          </View>
        </>
      ) : (
        <Card>
          <ThemedText type="smallBold">{t('account.cloudAccount')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('account.cloudDescription')}
          </ThemedText>
          <Button title={t('account.connect')} onPress={() => router.push('/sign-in')} />
          <ThemedText type="small" themeColor="textSecondary">
            {t('account.cloudSoon')}
          </ThemedText>
        </Card>
      )}
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
