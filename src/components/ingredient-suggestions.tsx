import { useValue } from '@legendapp/state/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { aiSettingsKey, useAiSettings } from '@/lib/api/ai';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/lib/auth/session';
import { useT } from '@/lib/i18n';
import { store$ } from '@/lib/store/collections';
import { useLocale } from '@/lib/store/settings';

type Props = { dinnerId: string; name: string; ingredients: string[]; onAdd: (name: string) => void };

export function IngredientSuggestions({ dinnerId, name, ingredients, onAdd }: Props) {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  const { user, request } = useSession();
  const { settings } = useAiSettings();
  const client = useQueryClient();
  const context = JSON.stringify({ name: name.trim(), ingredients: [...ingredients].sort(), locale });
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSettled(context), 1800);
    return () => clearTimeout(timer);
  }, [context]);
  const dismissed = useValue(() => store$.meta.aiDismissedSuggestions.get()?.[dinnerId]) ?? [];
  const boundAccount = useValue(store$.meta.accountId);
  const boundHousehold = useValue(store$.meta.serverHouseholdId);
  const enabled = boundAccount === user?.id && boundHousehold === user?.current_household?.id && !!user?.current_household && !!settings?.available && settings.email_verified
    && settings.suggestions_enabled;
  const valid = name.trim().length >= 2 && name.length <= 120
    && ingredients.length <= 40 && ingredients.every((item) => item.length <= 120);
  const query = useQuery({
    queryKey: ['ingredient-suggestions', user?.id, user?.current_household?.id, dinnerId, context],
    queryFn: async ({ signal }) => {
      try {
        return await request<{ ingredients: string[] }>('/ai/suggest', {
          method: 'POST', body: JSON.parse(context), signal,
        });
      } finally {
        void client.invalidateQueries({ queryKey: aiSettingsKey(user?.id, user?.current_household?.id) });
      }
    },
    enabled: enabled && valid && settled === context && (settings?.usage.suggestions.remaining ?? 0) > 0,
    retry: false,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
  if (!enabled || !valid || settled !== context) return null;
  if (!query.data && ((query.error instanceof ApiError && query.error.status === 429)
    || settings?.usage.suggestions.remaining === 0)) {
    return <ThemedText type="small" themeColor="textSecondary">{t('ai.limitReached')}</ThemedText>;
  }
  const existing = new Set(ingredients.map((item) => item.trim().toLocaleLowerCase()));
  const names = (query.data?.ingredients ?? []).filter((item) => !existing.has(item.toLocaleLowerCase()) && !dismissed.includes(item));
  if (!names.length) return null;
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <ThemedText type="small" themeColor="textSecondary">{t('ai.youCouldAdd')}</ThemedText>
        <Pressable accessibilityRole="button" accessibilityLabel={t('ai.dismiss')} hitSlop={8}
          onPress={() => store$.meta.aiDismissedSuggestions[dinnerId].set([...new Set([...dismissed, ...names])].slice(-30))}>
          <ThemedText type="small" themeColor="textSecondary">{t('ai.dismiss')}</ThemedText>
        </Pressable>
      </View>
      <View style={styles.chips}>
        {names.map((item) => (
          <Pressable key={item} accessibilityRole="button" accessibilityLabel={t('ai.add', { name: item })}
            onPress={() => onAdd(item)} style={[styles.chip, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="small">＋ {item}</ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.three, minHeight: 40, justifyContent: 'center' },
});
