import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WeekBoard } from '@/components/week-board';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { setPlannerWeekKey, usePlannerWeekKey } from '@/lib/planner-state';
import { createShoppingListFromPlan, dinnersWithoutIngredients } from '@/lib/shopping/generate';
import {
  updatePlanEntry,
  useLocale,
  usePlanEntries,
  usePlanForWeek,
  useShoppingListForPlan,
  type PlanEntryWithDinner,
} from '@/lib/store';
import {
  addWeeks,
  buildWeek,
  dateKeyOf,
  fromDateKey,
  startOfWeek,
  toDateKey,
  weekLabel,
} from '@/lib/week';

export default function PlansScreen() {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  const weekStartKey = usePlannerWeekKey();
  const weekStart = fromDateKey(weekStartKey);

  const days = buildWeek(weekStart, locale);
  const label = weekLabel(weekStart, locale);
  const isCurrentWeek = weekStartKey === toDateKey(startOfWeek(new Date()));

  const currentPlan = usePlanForWeek(weekStartKey);
  const entries = usePlanEntries(currentPlan?.id);
  // The list generated from this week, if any: the header button opens it
  // instead of making a second one.
  const existingList = useShoppingListForPlan(currentPlan?.id);
  // One list per tap — a double tap before navigation would build two.
  const creating = useRef(false);

  const entriesByDate: Record<string, PlanEntryWithDinner[]> = {};
  for (const entry of entries) {
    const key = dateKeyOf(entry.scheduled_date);
    (entriesByDate[key] ??= []).push(entry);
  }

  function onMove(entryId: string, toDate: string) {
    updatePlanEntry(entryId, { scheduled_date: toDate });
  }

  // Adding and editing happen in native sheets (root routes) that write to the
  // store; the board re-renders reactively when they close.
  function onAdd(date: string) {
    router.push({ pathname: '/sheets/dinner-picker', params: { date } });
  }

  function onEditEntry(entryId: string) {
    router.push({ pathname: '/sheets/entry-editor', params: { entryId } });
  }

  function openList(id: string) {
    router.push({ pathname: '/shopping/[id]', params: { id } });
  }

  // Build this week's list from its dinners. Dinners without ingredients add
  // nothing, which is easy to miss — name them first so the user can decide.
  function onMakeList() {
    if (!currentPlan || creating.current) return;
    const planId = currentPlan.id;
    const create = () => {
      creating.current = true;
      openList(createShoppingListFromPlan(planId));
      creating.current = false;
    };
    const missing = dinnersWithoutIngredients(planId);
    if (missing.length === 0) {
      create();
      return;
    }
    Alert.alert(
      t('plans.noIngredientsTitle'),
      t('plans.noIngredientsMessage', { names: missing.join(', ') }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('plans.makeAnyway'), onPress: create },
      ],
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.weekNav}>
            <NavButton
              label="‹"
              accessibilityLabel={t('a11y.previousWeek')}
              onPress={() => setPlannerWeekKey(toDateKey(addWeeks(weekStart, -1)))}
            />
            <View style={styles.weekLabel}>
              <Pressable
                onPress={() => router.push('/weeks')}
                hitSlop={8}
                style={({ pressed }) => [styles.weekLabelButton, pressed && styles.pressed]}>
                <ThemedText type="smallBold">{label}</ThemedText>
                <SymbolView
                  name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }}
                  size={11}
                  tintColor={theme.textSecondary}
                  type="monochrome"
                />
              </Pressable>
              {isCurrentWeek ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('plans.thisWeek')}
                </ThemedText>
              ) : (
                <Pressable
                  onPress={() => setPlannerWeekKey(toDateKey(startOfWeek(new Date())))}
                  hitSlop={6}>
                  <ThemedText type="small" style={{ color: theme.tint }}>
                    {t('plans.jumpToThisWeek')}
                  </ThemedText>
                </Pressable>
              )}
            </View>
            <NavButton
              label="›"
              accessibilityLabel={t('a11y.nextWeek')}
              onPress={() => setPlannerWeekKey(toDateKey(addWeeks(weekStart, 1)))}
            />
          </View>

          {/* The bridge from planning to shopping. Hidden until the week has a
              dinner, so an empty board stays quiet. */}
          {entries.length > 0 ? (
            <Pressable
              onPress={existingList ? () => openList(existingList.id) : onMakeList}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.listButton,
                { backgroundColor: existingList ? theme.backgroundElement : theme.tint },
                pressed && styles.pressed,
              ]}>
              <SymbolView
                name={{ ios: 'cart.fill', android: 'shopping_cart', web: 'shopping_cart' }}
                size={16}
                tintColor={existingList ? theme.text : theme.onTint}
                type="monochrome"
              />
              <ThemedText
                type="smallBold"
                style={{ color: existingList ? theme.text : theme.onTint }}>
                {existingList ? t('plans.openList') : t('plans.makeList')}
              </ThemedText>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={11}
                tintColor={existingList ? theme.textSecondary : theme.onTint}
                type="monochrome"
              />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.boardArea}>
          <WeekBoard
            days={days}
            entriesByDate={entriesByDate}
            onMove={onMove}
            onAdd={onAdd}
            onEdit={onEditEntry}
          />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

function NavButton({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={10}
      style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}>
      <ThemedText type="title" style={styles.navButtonText}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  listButton: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    borderRadius: 999,
  },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekLabel: {
    alignItems: 'center',
    gap: Spacing.half,
  },
  weekLabelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  navButton: {
    width: 44,
    alignItems: 'center',
  },
  navButtonText: {
    fontSize: 28,
    lineHeight: 32,
  },
  boardArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
  },
  pressed: {
    opacity: 0.5,
  },
});
