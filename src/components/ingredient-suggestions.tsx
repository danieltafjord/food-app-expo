import { useValue } from '@legendapp/state/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { aiSettingsKey, useAiSettings } from '@/lib/api/ai';
import { ApiError } from '@/lib/api/client';
import { DINNER_CATEGORIES, type BuiltinDinnerCategory, type DinnerCategory } from '@/lib/dinner-categories';
import { suggestionQueryOptions } from '@/lib/ai-suggestions';
import { useSession } from '@/lib/auth/session';
import { useT } from '@/lib/i18n';
import { useDinnerCategories } from '@/lib/store/dinner-categories';
import { store$ } from '@/lib/store/collections';
import { useLocale } from '@/lib/store/settings';

type Props = { category: DinnerCategory | null; dinnerId: string; name: string; ingredients: string[]; onAdd: (name: string) => void };

export function IngredientSuggestions({ dinnerId, name, ingredients, onAdd, category }: Props) {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  const { user, request } = useSession();
  const { settings } = useAiSettings();
  const client = useQueryClient();
  const categories = useDinnerCategories();
  const categoryContext = DINNER_CATEGORIES.includes(category as BuiltinDinnerCategory) ? category : categories.find((row) => row.id === category)?.name ?? null;
  const context = JSON.stringify({ name: name.trim(), ingredients: [...ingredients].sort(), locale, category: categoryContext });
  const dismissed = useValue(() => store$.meta.aiDismissedSuggestions.get()?.[dinnerId]) ?? [];
  const boundAccount = useValue(store$.meta.accountId);
  const boundHousehold = useValue(store$.meta.serverHouseholdId);
  const enabled = boundAccount === user?.id && boundHousehold === user?.current_household?.id && !!user?.current_household && !!settings?.available && settings.email_verified
    && settings.suggestions_enabled;
  const valid = name.trim().length >= 2 && name.length <= 120
    && ingredients.length <= 40 && ingredients.every((item) => item.length <= 120);
  const query = useQuery(suggestionQueryOptions(request,
    ['ingredient-suggestions', user?.id, user?.current_household?.id, dinnerId, context], context,
    () => { void client.invalidateQueries({ queryKey: aiSettingsKey(user?.id, user?.current_household?.id) }); },
  ));
  const userId = user?.id;
  const householdId = user?.current_household?.id;
  useEffect(() => {
    if (!enabled || !valid) void client.cancelQueries({ queryKey: ['ingredient-suggestions', userId, householdId, dinnerId] });
  }, [enabled, valid, client, userId, householdId, dinnerId]);
  if (!enabled || !valid) return null;
  const errorCode = query.error instanceof ApiError ? (query.error.body as { code?: string } | undefined)?.code : undefined;
  const existing = new Set(ingredients.map((item) => item.trim().toLocaleLowerCase()));
  const names = (query.data?.ingredients ?? []).filter((item) => !existing.has(item.toLocaleLowerCase()) && !dismissed.includes(item));
  return (
    <View style={styles.section}>
      <Button title={t(query.isError ? 'error.retry' : 'ai.requestSuggestions')} size="small" variant="secondary"
        loading={query.isFetching} onPress={() => { void query.refetch(); }} />
      {query.isError ? <ThemedText type="small" themeColor="textSecondary">
        {t(errorCode === 'daily_limit' ? 'ai.limitReached' : query.error instanceof ApiError && query.error.status === 429 ? 'ai.busy' : 'ai.requestFailed')}
      </ThemedText> : query.isSuccess && !names.length ? <ThemedText type="small" themeColor="textSecondary">{t('ai.noSuggestions')}</ThemedText> : null}
      {names.length > 0 ? (
        <>
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
                <Icon name="plus" size={11} weight="bold" color={theme.textSecondary} />
                <ThemedText type="small">{item}</ThemedText>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + Spacing.half, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.three, minHeight: 40 },
});
