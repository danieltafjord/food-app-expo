import { useValue } from '@legendapp/state/react';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatQuantity } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { usePlannerWeekKey } from '@/lib/planner-state';
import {
  createShoppingListFromPlan,
  previewPlanItems,
  updateShoppingListFromPlan,
} from '@/lib/shopping/generate';
import { useLocale, usePlanForWeek, useShoppingListForPlan } from '@/lib/store';
import { addWeeks, fromDateKey, toDateKey, weekLabel } from '@/lib/week';

export default function GenerateScreen() {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  // Start on the week the planner is showing, not on today's: the user came
  // here from planning that week.
  const plannerWeekKey = usePlannerWeekKey();
  const [weekStartKey, setWeekStartKey] = useState(plannerWeekKey);
  const weekStart = fromDateKey(weekStartKey);
  const label = weekLabel(weekStart, locale);
  const plan = usePlanForWeek(weekStartKey);
  const planId = plan?.id;
  const existing = useShoppingListForPlan(planId);
  // previewPlanItems reads the plan/dinner/ingredient collections, so useValue
  // re-runs and re-renders whenever any of them change.
  const preview = useValue(() => (planId ? previewPlanItems(planId) : []));
  // One action per visit — a double tap before `replace` navigates would
  // otherwise build two lists from the same plan.
  const submitted = useRef(false);

  function shiftWeek(delta: number) {
    setWeekStartKey(toDateKey(addWeeks(weekStart, delta)));
  }

  function openList(id: string) {
    router.replace({ pathname: '/shopping/[id]', params: { id } });
  }

  function onCreate() {
    if (!plan || submitted.current) return;
    submitted.current = true;
    openList(createShoppingListFromPlan(plan.id));
  }

  function onUpdate() {
    if (!plan || !existing || submitted.current) return;
    submitted.current = true;
    const { added, updated } = updateShoppingListFromPlan(existing.id, plan.id);
    if (added === 0 && updated === 0) {
      submitted.current = false;
      Alert.alert(existing.name, t('generate.updatedNothing'), [
        { text: t('generate.openExisting'), onPress: () => openList(existing.id) },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
      return;
    }
    openList(existing.id);
  }

  const createTitle =
    preview.length === 1
      ? t('generate.createListOne', { count: preview.length })
      : t('generate.createListMany', { count: preview.length });

  return (
    <Screen topInset={false} refreshable={false}>
      <Card>
        <View style={styles.weekNav}>
          <Pressable
            onPress={() => shiftWeek(-1)}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.previousWeek')}
            hitSlop={10}>
            <ThemedText type="title" style={styles.nav}>
              ‹
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold">{label}</ThemedText>
          <Pressable
            onPress={() => shiftWeek(1)}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.nextWeek')}
            hitSlop={10}>
            <ThemedText type="title" style={styles.nav}>
              ›
            </ThemedText>
          </Pressable>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {t('generate.description')}
        </ThemedText>
      </Card>

      {existing ? (
        <Card>
          <ThemedText type="smallBold">{t('generate.existingTitle')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('generate.existingMessage', { name: existing.name })}
          </ThemedText>
          <View style={styles.actions}>
            <Button
              title={t('generate.updateExisting')}
              onPress={onUpdate}
              disabled={preview.length === 0}
            />
            <Button
              title={t('generate.openExisting')}
              variant="secondary"
              onPress={() => openList(existing.id)}
            />
          </View>
        </Card>
      ) : null}

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
          {existing ? (
            <Button title={t('generate.createAnother')} variant="secondary" onPress={onCreate} />
          ) : (
            <Button title={createTitle} onPress={onCreate} />
          )}
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
  actions: {
    gap: Spacing.two,
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
