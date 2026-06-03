import { useValue } from '@legendapp/state/react';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatQuantity } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { createShoppingListFromPlan, previewPlanItems } from '@/lib/shopping/generate';
import { useLocale, usePlanForWeek } from '@/lib/store';
import { addWeeks, startOfWeek, toDateKey, weekLabel } from '@/lib/week';

export default function GenerateScreen() {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const weekStartKey = toDateKey(weekStart);
  const label = weekLabel(weekStart, locale);
  const plan = usePlanForWeek(weekStartKey);
  const planId = plan?.id;
  // previewPlanItems reads the plan/dinner/ingredient collections, so useValue
  // re-runs and re-renders whenever any of them change.
  const preview = useValue(() => (planId ? previewPlanItems(planId) : []));

  function onCreate() {
    if (!plan) {
      return;
    }
    const id = createShoppingListFromPlan(plan.id);
    router.replace({ pathname: '/shopping/[id]', params: { id } });
  }

  return (
    <Screen topInset={false} refreshable={false}>
      <Card>
        <View style={styles.weekNav}>
          <Pressable onPress={() => setWeekStart((w) => addWeeks(w, -1))} hitSlop={10}>
            <ThemedText type="title" style={styles.nav}>
              ‹
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold">{label}</ThemedText>
          <Pressable onPress={() => setWeekStart((w) => addWeeks(w, 1))} hitSlop={10}>
            <ThemedText type="title" style={styles.nav}>
              ›
            </ThemedText>
          </Pressable>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {t('generate.description')}
        </ThemedText>
      </Card>

      {preview.length > 0 ? (
        <>
          <Card>
            {preview.map((row, index) => (
              <View
                key={`${row.ingredient_id}|${row.unit ?? ''}`}
                style={[
                  styles.row,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                ]}>
                <ThemedText style={styles.flex} numberOfLines={1}>
                  {row.ingredient_name ?? t('common.ingredientFallback')}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatQuantity(row.quantity, row.unit)}
                </ThemedText>
              </View>
            ))}
          </Card>
          <Button
            title={
              preview.length === 1
                ? t('generate.createListOne', { count: preview.length })
                : t('generate.createListMany', { count: preview.length })
            }
            onPress={onCreate}
          />
        </>
      ) : (
        <ThemedText themeColor="textSecondary">
          {plan ? t('generate.noDinners') : t('generate.noPlan')}
        </ThemedText>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nav: {
    fontSize: 28,
    lineHeight: 32,
    paddingHorizontal: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  flex: {
    flexShrink: 1,
  },
});
