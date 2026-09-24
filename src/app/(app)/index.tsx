import { GlassContainer, GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WeekPager, type WeekPagerHandle } from '@/components/week-pager';
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
} from '@/lib/store';
import {
  addWeeks,
  fromDateKey,
  startOfWeek,
  toDateKey,
  weekLabel,
} from '@/lib/week';

const ACTION_HEIGHT = 48;
// Two equal halves read as a pair on phones without stretching into bars on iPad.
const ACTION_DOCK_MAX_WIDTH = 440;

const glass = isLiquidGlassAvailable();

export default function PlansScreen() {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  const weekStartKey = usePlannerWeekKey();
  const weekStart = fromDateKey(weekStartKey);

  const label = weekLabel(weekStart, locale);
  const isCurrentWeek = weekStartKey === toDateKey(startOfWeek(new Date()));

  const currentPlan = usePlanForWeek(weekStartKey);
  // A dinner deleted with Undo still pending leaves the board at once.
  const hidden = useHiddenIds();
  const entries = usePlanEntries(currentPlan?.id).filter((entry) => !hidden[entry.dinner_id]);
  const planning = useWeekPlanningContext(weekStartKey);
  const showPlanAction = planning.dates.length > 0;
  const showListAction = entries.length > 0;
  const showActionDock = showPlanAction || showListAction;
  const [actionDockHeight, setActionDockHeight] = useState(ACTION_HEIGHT);
  // The list generated from this week, if any: the shopping button opens it
  // instead of making a second one.
  const existingList = useShoppingListForPlan(currentPlan?.id);
  // One list per tap — a double tap before navigation would build two.
  const creating = useRef(false);
  const weekPager = useRef<WeekPagerHandle>(null);

  function onChangeWeek(direction: -1 | 1) {
    hapticLight();
    setPlannerWeekKey(toDateKey(addWeeks(weekStart, direction)));
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
              onPress={() => weekPager.current?.changeWeek(-1)}
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
              onPress={() => weekPager.current?.changeWeek(1)}
            />
          </View>
        </View>

        <WeekPager
          ref={weekPager}
          weekKey={weekStartKey}
          onMove={onMove}
          onAdd={onAdd}
          onEdit={onEditEntry}
          onChangeWeek={onChangeWeek}
          bottomContentInset={BottomTabInset + Spacing.three
            + (showActionDock ? actionDockHeight + Spacing.two : 0)}
        />

        {showActionDock ? (
          <View
            pointerEvents="box-none"
            style={styles.actionDock}
            onLayout={(event) => setActionDockHeight(event.nativeEvent.layout.height)}>
            <GlassContainer style={styles.actionRow}>
              {showPlanAction ? (
                <PlannerAction
                  icon="sparkles"
                  label={t('weekPlanning.title')}
                  prominent
                  accessibilityHint={t('weekPlanning.actionHint')}
                  onPress={() => {
                    hapticSelection();
                    pushOnce({ pathname: '/sheets/plan-week', params: { weekStart: weekStartKey } });
                  }}
                />
              ) : null}
              {showListAction ? (
                <PlannerAction
                  icon="cart"
                  label={existingList ? t('plans.openList') : t('plans.makeList')}
                  prominent={!showPlanAction}
                  onPress={existingList ? () => openList(existingList.id) : onMakeList}
                />
              ) : null}
            </GlassContainer>
          </View>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

// Monochrome, not brand blue: the prominent action is ink on the page (black in
// light mode, white in dark), the other is plain glass. Only one is ever
// prominent, so the pair has a clear lead without a second colour.
function PlannerAction({
  icon, label, accessibilityHint, prominent = false, onPress,
}: {
  icon: IconName;
  label: string;
  accessibilityHint?: string;
  prominent?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const color = prominent ? theme.background : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.action, !glass && pressed && styles.actionPressed]}>
      <GlassView
        glassEffectStyle="regular"
        tintColor={prominent ? theme.text : undefined}
        isInteractive
        colorScheme={scheme}
        style={[
          styles.actionButton,
          !glass && [
            styles.actionButtonSolid,
            prominent
              ? { backgroundColor: theme.text }
              : { backgroundColor: theme.background, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth },
          ],
        ]}>
        <Icon name={icon} size={14} color={color} />
        <ThemedText
          type="smallBold"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
          style={[styles.actionLabel, { color }]}>
          {label}
        </ThemedText>
      </GlassView>
    </Pressable>
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
      onPress={onPress}
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
  },
  // Each action takes an equal share, so the pair stays mirrored whatever the
  // labels say, and a lone action spans the dock instead of floating off-centre.
  actionDock: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    bottom: BottomTabInset + Spacing.two,
    alignItems: 'center',
  },
  actionRow: {
    width: '100%',
    maxWidth: ACTION_DOCK_MAX_WIDTH,
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
  },
  actionButton: {
    flex: 1,
    minHeight: ACTION_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.one + Spacing.half,
    borderRadius: 999,
  },
  actionButtonSolid: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  actionPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  actionLabel: {
    flexShrink: 1,
    fontWeight: 600,
    letterSpacing: -0.1,
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
  pressed: {
    opacity: 0.5,
  },
});
