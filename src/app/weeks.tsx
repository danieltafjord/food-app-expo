import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { setPlannerWeekKey, usePlannerWeekKey } from '@/lib/planner-state';
import { useLocale, useWeekFill } from '@/lib/store';
import { addDays, addWeeks, fromDateKey, startOfWeek, toDateKey, weekLabel } from '@/lib/week';

/** Padding weeks shown around today so there's always somewhere to plan into. */
const WINDOW_BEFORE = 4;
const WINDOW_AFTER = 8;
/** Hard bounds so a single far-off plan can't generate hundreds of empty rows. */
const MAX_BEFORE = 52;
const MAX_AFTER = 104;

type WeekRow = {
  key: string;
  date: Date;
  label: string;
  /** Set only on the first week of each month, to print a month header above it. */
  monthLabel: string | null;
  dayKeys: string[];
  isCurrent: boolean;
  isSelected: boolean;
};

/**
 * Full-screen overview of weeks as a grid (rows of weeks × the seven weekdays).
 * A dot lights up for any day that has a dinner, so full and empty weeks read at
 * a glance. The current week is ringed, the week the board is showing is filled,
 * and tapping any week jumps the board to it. Presented as a root modal (above
 * the tab bar) from the Plans tab's week label.
 */
export default function WeeksScreen() {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  const fill = useWeekFill();
  const selectedKey = usePlannerWeekKey();
  const scrollRef = useRef<ScrollView>(null);
  const didScroll = useRef(false);

  const todayWeek = startOfWeek(new Date());
  const todayKey = toDateKey(todayWeek);
  const selectedWeek = fromDateKey(selectedKey);

  // Range = today's window, widened to include any planned week and the week
  // being viewed, then clamped so a stray far-off plan can't explode the list.
  let min = addWeeks(todayWeek, -WINDOW_BEFORE);
  let max = addWeeks(todayWeek, WINDOW_AFTER);
  const widen = (d: Date) => {
    if (d < min) min = d;
    if (d > max) max = d;
  };
  for (const key of Object.keys(fill)) widen(fromDateKey(key));
  widen(selectedWeek);
  const hardMin = addWeeks(todayWeek, -MAX_BEFORE);
  const hardMax = addWeeks(todayWeek, MAX_AFTER);
  if (min < hardMin) min = hardMin;
  if (max > hardMax) max = hardMax;

  const rows: WeekRow[] = [];
  let prevMonth = '';
  for (let d = startOfWeek(min); d <= max; d = addWeeks(d, 1)) {
    const key = toDateKey(d);
    const month = d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    rows.push({
      key,
      date: new Date(d),
      label: weekLabel(d, locale),
      monthLabel: month !== prevMonth ? titleCase(month) : null,
      dayKeys: Array.from({ length: 7 }, (_, i) => toDateKey(addDays(d, i))),
      isCurrent: key === todayKey,
      isSelected: key === selectedKey,
    });
    prevMonth = month;
  }

  // Localized single-letter weekday headers, Monday→Sunday.
  const weekdayInitials = Array.from({ length: 7 }, (_, i) =>
    addDays(todayWeek, i).toLocaleDateString(locale, { weekday: 'narrow' }).toUpperCase(),
  );

  // Normally pushed from the Plans tab, so `back()` returns there. Fall back to
  // the tab when there's nothing to pop (e.g. opened cold via a `foodapp://weeks`
  // deep link), so the modal is always dismissable.
  function dismiss() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }

  function onSelect(key: string) {
    setPlannerWeekKey(key);
    dismiss();
  }

  function onSelectedLayout(event: LayoutChangeEvent) {
    if (didScroll.current) return;
    didScroll.current = true;
    const y = event.nativeEvent.layout.y;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - Spacing.six), animated: false });
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.safe}>
        <View style={styles.headerBar}>
          <ThemedText type="subtitle">{t('plans.weeksTitle')}</ThemedText>
          <Pressable
            onPress={dismiss}
            hitSlop={10}
            accessibilityRole="button"
            style={({ pressed }) => pressed && styles.pressed}>
            <SymbolView
              name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
              size={28}
              tintColor={theme.textSecondary}
              type="hierarchical"
            />
          </Pressable>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {t('plans.weeksHint')}
        </ThemedText>

        <View style={styles.weekdayRow}>
          <View style={styles.labelCol} />
          <View style={styles.dotsRow}>
            {weekdayInitials.map((initial, i) => (
              <View key={i} style={styles.dotCell}>
                <ThemedText type="small" themeColor="textSecondary">
                  {initial}
                </ThemedText>
              </View>
            ))}
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}>
          {rows.map((row) => (
            <View key={row.key} onLayout={row.isSelected ? onSelectedLayout : undefined}>
              {row.monthLabel ? (
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.month}>
                  {row.monthLabel}
                </ThemedText>
              ) : null}
              <Pressable
                onPress={() => onSelect(row.key)}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView
                  type={row.isSelected ? 'backgroundSelected' : 'backgroundElement'}
                  style={[styles.weekRow, row.isCurrent && { borderColor: theme.tint }]}>
                  <View style={styles.labelCol}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {row.label}
                    </ThemedText>
                    {row.isCurrent ? (
                      <ThemedText type="small" style={{ color: theme.tint }}>
                        {t('plans.thisWeek')}
                      </ThemedText>
                    ) : null}
                  </View>
                  <View style={styles.dotsRow}>
                    {row.dayKeys.map((dayKey) => {
                      const on = fill[row.key]?.has(dayKey) ?? false;
                      return (
                        <View key={dayKey} style={styles.dotCell}>
                          <View
                            style={[styles.dot, { backgroundColor: on ? theme.tint : theme.border }]}
                          />
                        </View>
                      );
                    })}
                  </View>
                </ThemedView>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

/** Capitalize the first letter — month names are lowercase in some locales (e.g. "juni"). */
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingTop: Spacing.four,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hint: {
    marginTop: -Spacing.two,
  },
  weekdayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: Spacing.five,
  },
  month: {
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
    paddingHorizontal: Spacing.one,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  labelCol: {
    width: 88,
    gap: Spacing.half,
  },
  dotsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dotCell: {
    flex: 1,
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pressed: {
    opacity: 0.6,
  },
});
