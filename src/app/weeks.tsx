import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { dateFormatter } from '@/lib/intl';
import { setPlannerWeekKey, usePlannerWeekKey } from '@/lib/planner-state';
import { useLocale, useWeekFill } from '@/lib/store';
import { addDays, addWeeks, fromDateKey, startOfWeek, toDateKey, weekLabel } from '@/lib/week';

/** Padding weeks shown around today so there's always somewhere to plan into. */
const WINDOW_BEFORE = 4;
const WINDOW_AFTER = 8;
/** Hard bounds so a single far-off plan can't generate hundreds of empty rows. */
const MAX_BEFORE = 52;
const MAX_AFTER = 104;

/**
 * Fixed row heights so the list can be virtualised AND opened directly at the
 * selected week (`getItemLayout` + `initialScrollIndex`) — no mounting a
 * hundred-plus rows of dots and then jumping once they have laid out.
 */
const WEEK_ROW_HEIGHT = 56;
const WEEK_ROW_GAP = Spacing.two;
const WEEK_ITEM_HEIGHT = WEEK_ROW_HEIGHT + WEEK_ROW_GAP;
const MONTH_ITEM_HEIGHT = 40;
const MONTH_LONG: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
const WEEKDAY_NARROW: Intl.DateTimeFormatOptions = { weekday: 'narrow' };

type WeekRow = {
  kind: 'week';
  key: string;
  label: string;
  dayKeys: string[];
  isCurrent: boolean;
  isSelected: boolean;
};

/** Printed above the first week of each month. */
type MonthRow = { kind: 'month'; key: string; label: string };

type Row = WeekRow | MonthRow;

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

  const rows: Row[] = [];
  // Cumulative y of each row, for `getItemLayout` (rows have two fixed heights).
  const offsets: number[] = [];
  let selectedIndex = 0;
  let prevMonth = '';
  let y = 0;
  const monthOf = dateFormatter(locale, MONTH_LONG);
  for (let d = startOfWeek(min); d <= max; d = addWeeks(d, 1)) {
    const key = toDateKey(d);
    const month = monthOf.format(d);
    if (month !== prevMonth) {
      offsets.push(y);
      rows.push({ kind: 'month', key: `m:${key}`, label: titleCase(month) });
      y += MONTH_ITEM_HEIGHT;
      prevMonth = month;
    }
    if (key === selectedKey) selectedIndex = rows.length;
    offsets.push(y);
    rows.push({
      kind: 'week',
      key,
      label: weekLabel(d, locale),
      dayKeys: Array.from({ length: 7 }, (_, i) => toDateKey(addDays(d, i))),
      isCurrent: key === todayKey,
      isSelected: key === selectedKey,
    });
    y += WEEK_ITEM_HEIGHT;
  }

  // Localized single-letter weekday headers, Monday→Sunday.
  const weekdayOf = dateFormatter(locale, WEEKDAY_NARROW);
  const weekdayInitials = Array.from({ length: 7 }, (_, i) =>
    weekdayOf.format(addDays(todayWeek, i)).toUpperCase(),
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

  function getItemLayout(_: ArrayLike<Row> | null | undefined, index: number) {
    const row = rows[index];
    return {
      length: row?.kind === 'month' ? MONTH_ITEM_HEIGHT : WEEK_ITEM_HEIGHT,
      offset: offsets[index] ?? 0,
      index,
    };
  }

  // Open with the selected week a little below the top; its month header
  // (the row before it) is included when there is one.
  const initialIndex = Math.max(0, rows[selectedIndex - 1]?.kind === 'month' ? selectedIndex - 1 : selectedIndex);

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

        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          getItemLayout={getItemLayout}
          initialScrollIndex={initialIndex}
          initialNumToRender={16}
          windowSize={7}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: row }) =>
            row.kind === 'month' ? (
              <View style={styles.month}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {row.label}
                </ThemedText>
              </View>
            ) : (
              <Pressable
                onPress={() => onSelect(row.key)}
                style={({ pressed }) => [styles.weekItem, pressed && styles.pressed]}>
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
            )
          }
        />
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
    height: MONTH_ITEM_HEIGHT,
    justifyContent: 'flex-end',
    paddingBottom: Spacing.one,
    paddingHorizontal: Spacing.one,
  },
  weekItem: {
    height: WEEK_ITEM_HEIGHT,
    paddingBottom: WEEK_ROW_GAP,
  },
  weekRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingHorizontal: Spacing.three,
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
