import { StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAiSettings, useUpdateAiSettings, type AiFeature } from '@/lib/api/ai';
import { useSession } from '@/lib/auth/session';
import { useT } from '@/lib/i18n';
import { useLocale } from '@/lib/store/settings';

export function AiSettingsSection() {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  const { isAuthenticated, user } = useSession();
  const query = useAiSettings();
  const update = useUpdateAiSettings();
  const settings = query.settings;

  function change(feature: AiFeature, enabled: boolean) {
    if (!settings) return;
    update.mutate({
      categorization_enabled: feature === 'categorization' ? enabled : settings.categorization_enabled,
      suggestions_enabled: feature === 'suggestions' ? enabled : settings.suggestions_enabled,
    });
  }

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.title}>
        {t('ai.settingsTitle')}
      </ThemedText>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">{t('ai.privacy')}</ThemedText>
        {!isAuthenticated || !user?.current_household ? (
          <ThemedText type="small" themeColor="textSecondary">{t('ai.signIn')}</ThemedText>
        ) : settings ? (
          <>
            {(['categorization', 'suggestions'] as const).map((feature) => (
              <View key={feature} style={styles.row}>
                <View style={styles.label}>
                  <ThemedText type="smallBold">{t(feature === 'categorization' ? 'ai.categorization' : 'ai.suggestions')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t(feature === 'categorization' ? 'ai.categorizationHint' : 'ai.suggestionsHint')}
                  </ThemedText>
                </View>
                <Switch
                  value={settings[`${feature}_enabled`]}
                  onValueChange={(enabled) => change(feature, enabled)}
                  disabled={update.isPending}
                  trackColor={{ true: theme.accent }}
                  accessibilityLabel={t(feature === 'categorization' ? 'ai.categorization' : 'ai.suggestions')}
                />
              </View>
            ))}
            {!settings.email_verified ? <ThemedText type="small" themeColor="textSecondary">{t('ai.verifyEmail')}</ThemedText> : null}
            {!settings.available ? <ThemedText type="small" themeColor="textSecondary">{t('ai.unavailable')}</ThemedText> : null}
            <ThemedText type="small" themeColor="textSecondary">
              {t('ai.allowance', {
                classifications: settings.usage.categorization.remaining,
                suggestions: settings.usage.suggestions.remaining,
              })}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('ai.resets', { time: new Date(settings.usage.resets_at).toLocaleString(locale) })}
            </ThemedText>
          </>
        ) : query.isError ? (
          <Button title={t('error.retry')} variant="secondary" size="small" onPress={() => { void query.refetch(); }} />
        ) : <ThemedText type="small" themeColor="textSecondary">{t('ai.loadingSettings')}</ThemedText>}
        {update.isError ? (
          <>
            <ThemedText type="small" style={{ color: theme.danger }}>{t('ai.saveFailed')}</ThemedText>
            <Button title={t('error.retry')} size="small" variant="secondary" onPress={() => {
              if (update.variables) update.mutate(update.variables);
            }} />
          </>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  title: { paddingHorizontal: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  label: { flex: 1, gap: Spacing.one },
});
