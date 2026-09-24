import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useRef } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LayoutAnimationConfig } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WeekBoard } from '@/components/week-board';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { hapticLight, hapticSelection } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { pushOnce } from '@/lib/navigation';
import { setPlannerWeekKey, usePlannerWeekKey } from '@/lib/planner-state';
import { createShoppingListFromPlan, dinnersWithoutIngredients } from '@/lib/shopping/generate';
import { useWeekPlanningContext } from '@/lib/store/week-planning';
import { useHiddenIds } from '@/lib/undo';
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

/** Height the floating plan button (and the gap under it) takes from the bottom of the board. */
const PLAN_DOCK = 56 + Spacing.three;

const WEEK_ENTER = FadeIn.duration(200);

const glass = isLiquidGlassAvailable();

export default function PlansScreen() {
  const t = useT();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const locale = useLocale();
  const weekStartKey = usePlannerWeekKey();
  const weekStart = fromDateKey(weekStartKey);

  const days = buildWeek(weekStart, locale);
  const label = weekLabel(weekStart, locale);
  const isCurrentWeek = weekStartKey === toDateKey(startOfWeek(new Date()));

  const currentPlan = usePlanForWeek(weekStartKey);
  // A dinner deleted with Undo still pending leaves the board at once.
  const hidden = useHiddenIds();
  const entries = usePlanEntries(currentPlan?.id).filter((entry) => !hidden[entry.dinner_id]);
  const planning = useWeekPlanningContext(weekStartKey);
  const showPlanAction = planning.dates.length > 0;
  const canPlan = planning.missing === 0;
  const planHint = canPlan
    ? t('weekPlanning.actionHint')
    : t(planning.missing === 1 ? 'weekPlanning.needOne' : 'weekPlanning.needMore', { count: planning.missing });
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
    pushOnce({ pathname: '/sheets/dinner-picker', params: { date } });
  }

  function onEditEntry(entryId: string) {
    pushOnce({ pathname: '/sheets/entry-editor', params: { entryId } });
  }

  function openList(id: string) {
    pushOnce({ pathname: '/shopping/[id]', params: { id } });
  }

  // Build this week's list from its dinners. Dinners without ingredients add
  // nothing, which is easy to miss — name them first so the user can decide.
  function onMakeList() {
    if (!currentPlan || creating.current) return;
    const planId = currentPlan.id;
    const create = () => {
      creating.current = true;
      openList(createShoppingListFromPlan(planId));
      // Released after the push has landed — resetting it on the same tick
      // guarded nothing, since creating the list is synchronous.
      setTimeout(() => {
        creating.current = false;
      }, 1000);
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
              icon="chevron.left"
              accessibilityLabel={t('a11y.previousWeek')}
              onPress={() => setPlannerWeekKey(toDateKey(addWeeks(weekStart, -1)))}
            />
            <View style={styles.weekLabel}>
              <Pressable
                onPress={() => pushOnce('/weeks')}
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
                  onPress={() => {
                    hapticLight();
                    setPlannerWeekKey(toDateKey(startOfWeek(new Date())));
                  }}
                  hitSlop={6}>
                  <ThemedText type="small" style={{ color: theme.tint }}>
                    {t('plans.jumpToThisWeek')}
                  </ThemedText>
                </Pressable>
              )}
            </View>
            <NavButton
              icon="chevron.right"
              accessibilityLabel={t('a11y.nextWeek')}
              onPress={() => setPlannerWeekKey(toDateKey(addWeeks(weekStart, 1)))}
            />
          </View>

          {/* The bridge from planning to shopping. Hidden until the week has a
              dinner, so an empty board stays quiet. */}
          {entries.length > 0 ? (
            <PressableScale
              onPress={existingList ? () => openList(existingList.id) : onMakeList}
              accessibilityRole="button"
              style={[
                styles.listButton,
                { backgroundColor: existingList ? theme.backgroundElement : theme.tint },
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
            </PressableScale>
          ) : null}
        </View>

        {/* The board runs to the bottom edge and scrolls under the floating
            plan button and the tab bar. Keyed by week so switching weeks fades
            the new one in rather than swapping it in a single frame. */}
        <LayoutAnimationConfig skipEntering>
          <Animated.View key={weekStartKey} entering={WEEK_ENTER} style={styles.boardArea}>
            <WeekBoard
              days={days}
              entriesByDate={entriesByDate}
              onMove={onMove}
              onAdd={onAdd}
              onEdit={onEditEntry}
              bottomContentInset={BottomTabInset + Spacing.three + (showPlanAction ? PLAN_DOCK : 0)}
            />
          </Animated.View>
        </LayoutAnimationConfig>

        {showPlanAction ? (
          <View pointerEvents="box-none" style={styles.planDock}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('weekPlanning.title')}
              accessibilityHint={planHint}
              accessibilityState={{ disabled: !canPlan }}
              disabled={!canPlan}
              onPress={() => {
                hapticSelection();
                pushOnce({ pathname: '/sheets/plan-week', params: { weekStart: weekStartKey } });
              }}
              style={({ pressed }) => [!glass && pressed && styles.pressed]}>
              {/* Liquid Glass on iOS 26, matching the tab bar under it; tinted
                  tomato once the week can be planned. Elsewhere GlassView is a
                  plain view, so it gets a solid surface instead. */}
              <GlassView
                glassEffectStyle="regular"
                isInteractive={canPlan}
                tintColor={canPlan ? theme.accent : undefined}
                colorScheme={scheme}
                style={[
                  styles.planButton,
                  !glass && [
                    styles.planButtonSolid,
                    { backgroundColor: canPlan ? theme.accent : theme.backgroundElement },
                  ],
                ]}>
                <Icon
                  name="sparkles"
                  size={16}
                  color={canPlan ? theme.onTint : theme.textSecondary}
                />
                <View style={styles.planText}>
                  <ThemedText
                    type="smallBold"
                    numberOfLines={1}
                    style={{ color: canPlan ? theme.onTint : theme.text }}>
                    {t('weekPlanning.title')}
                  </ThemedText>
                  {!canPlan ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.planHint}>
                      {planHint}
                    </ThemedText>
                  ) : null}
                </View>
              </GlassView>
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

function NavButton({
  icon,
  accessibilityLabel,
  onPress,
}: {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        hapticLight();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={10}
      style={({ pressed }) => [
        styles.navButton,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <Icon name={icon} size={15} weight="bold" color={theme.text} />
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
  planDock: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    bottom: BottomTabInset + Spacing.two,
    alignItems: 'center',
  },
  planButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  planButtonSolid: {
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  planText: {
    flexShrink: 1,
  },
  planHint: {
    fontSize: 12,
    lineHeight: 16,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
  },
  pressed: {
    opacity: 0.5,
  },
});
