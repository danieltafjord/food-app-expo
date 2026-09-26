import { useValue } from '@legendapp/state/react';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { SheetScreen } from '@/components/sheet';
import { Stepper } from '@/components/stepper';
import { Separator, SettingRow, SuggestionSettings, settingStyles, usePlanningPreferences } from '@/components/suggestion-settings';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useHouseholdIngredientExclusions } from '@/lib/api/ingredient-exclusions';
import { suggestDinners, useIncomingDays } from '@/lib/dinner-suggester';
import { hapticSelection } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { capitalize, weekdayWithDay } from '@/lib/format';
import { dateFormatter } from '@/lib/intl';
import { store$ } from '@/lib/store/collections';
import { useHouseholdDefaultServings } from '@/lib/store/household';
import { useLocale } from '@/lib/store/settings';
import { suggestionContext$ } from '@/lib/store/week-suggestions';
import { buildWeek, fromDateKey, startOfWeek, toDateKey } from '@/lib/week';

export default function PlanWeekSheet() {
  const { weekStart } = useLocalSearchParams<{ weekStart: string }>();
  const t = useT();
  const scope = useValue(() => `${store$.meta.localHouseholdId.get()}/${store$.meta.accountId.get()}/${store$.meta.serverHouseholdId.get()}`);
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)
    || toDateKey(startOfWeek(fromDateKey(weekStart))) !== weekStart) {
    return <SheetScreen title={t('weekPlanning.title')}><Button title={t('common.back')} onPress={() => router.back()} /></SheetScreen>;
  }
  return <WeekPlanner key={`${scope}/${weekStart}`} weekStart={weekStart} />;
}

/**
 * Fill the week's open days in one tap. The sheet says what happens (dinners
 * land on the board and can be swapped there), then shows one card of rows —
 * days, where dinners come from, wishes, ingredients to avoid — each with its
 * current value, opening in place to change it. Opened, the days read like
 * the board: one row per day left in the week, ticked when it's to be filled,
 * with that day's servings beside it; days that already have a dinner say so.
 * Everything starts filled in, so the button alone is enough. See
 * `@/lib/dinner-suggester` for the request; the sheet closes as soon as it
 * starts.
 */
function WeekPlanner({ weekStart }: { weekStart: string }) {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  const defaultServings = useHouseholdDefaultServings();
  const { preferences, ai } = usePlanningPreferences();
  const { ready: exclusionsLoaded } = useHouseholdIngredientExclusions();
  const [editingExclusions, setEditingExclusions] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (row: string) => setExpanded(expanded === row ? null : row);
  const context = useValue(suggestionContext$(weekStart));
  // Days a running request is already filling aren't offered again.
  const incoming = useIncomingDays();
  const openDates = context.dates.filter((date) => !incoming[date]);
  // Remember the days switched off, so a day that opens up meanwhile starts on.
  const [skipped, setSkipped] = useState<string[]>([]);
  const dates = openDates.filter((date) => !skipped.includes(date));
  const [servingsByDate, setServingsByDate] = useState<Record<string, number>>({});
  const servingsFor = (date: string) => servingsByDate[date] ?? defaultServings;
  const today = toDateKey(new Date());
  const weekday = dateFormatter(locale, { weekday: 'long' });
  const dayName = (date: string) =>
    capitalize(weekdayWithDay(weekday.format(fromDateKey(date)), fromDateKey(date).getDate(), locale));
  const days = buildWeek(fromDateKey(weekStart), locale).filter((day) => day.date >= today);
  const servingValues = [...new Set(dates.map(servingsFor))].sort((a, b) => a - b);
  const servingsSummary = servingValues.length > 1
    ? t('weekPlanning.servingsRange', { min: servingValues[0], max: servingValues[servingValues.length - 1] })
    : `${servingValues[0]} ${t(servingValues[0] === 1 ? 'common.serving' : 'common.servings')}`;
  const daysSummary = !dates.length ? t('weekPlanning.noDays')
    : `${dates.length === 1 ? dayName(dates[0])
      : dates.length < openDates.length ? t('weekPlanning.someDays', { count: dates.length, total: openDates.length })
        : openDates.length === 7 ? t('weekPlanning.wholeWeek') : t('weekPlanning.allOpen', { count: openDates.length })
    } · ${servingsSummary}`;
  const vegetarian = preferences.shortcuts.includes('vegetarian');
  const saved = context.candidates.filter((candidate) => !vegetarian || candidate.category === 'vegetarian').length;
  // The household's own list can't fill more days than it has dinners for
  // (with none, the button still names the days and the note says why it's off).
  const count = ai ? dates.length : Math.min(dates.length, saved);
  const shown = count || dates.length;
  // The household's own list works offline from the saved copy of the exclusions.
  const canStart = count > 0 && !editingExclusions && (!ai || exclusionsLoaded);

  function toggleDay(date: string) {
    hapticSelection();
    setSkipped((current) => current.includes(date) ? current.filter((value) => value !== date) : [...current, date]);
  }

  function start() {
    if (!canStart) return;
    Keyboard.dismiss();
    void suggestDinners({ kind: 'week', weekStart, servings: Object.fromEntries(dates.map((date) => [date, servingsFor(date)])) });
    router.back();
  }

  if (openDates.length === 0) {
    return (
      <SheetScreen title={t('weekPlanning.title')} layout="fill">
        <EmptyState icon="checkmark" title={t('weekPlanning.noEmptyDaysTitle')} message={t('weekPlanning.noEmptyDays')} />
      </SheetScreen>
    );
  }

  return (
    <SheetScreen title={t('weekPlanning.title')} layout="fill">
      <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>{t('weekPlanning.intro')}</ThemedText>
      <ScrollView style={styles.fill} contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <SuggestionSettings expanded={expanded} onToggle={toggle} onEditingExclusionsChange={setEditingExclusions}
          note={!ai && saved < dates.length ? (
            <ThemedText type="small" themeColor="textSecondary" style={settingStyles.label}>
              {saved ? t('weekPlanning.notEnoughSaved', { count: saved }) : t('weekPlanning.noneSaved')}
            </ThemedText>
          ) : null}>
          <SettingRow label={t('weekPlanning.days')} value={daysSummary}
            open={expanded === 'days'} onPress={() => toggle('days')} />
          {expanded === 'days' ? days.map((day) => {
            const open = openDates.includes(day.date);
            const checked = open && dates.includes(day.date);
            const label = dayName(day.date);
            const color = day.isToday ? theme.accentText : checked ? theme.text : theme.textSecondary;
            return (
              <View key={day.date}>
                <Separator inset={styles.daySeparator} />
                <View style={[styles.row, styles.dayRow]}>
                  {open ? (
                    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label}
                      onPress={() => toggleDay(day.date)} style={({ pressed }) => [styles.dayToggle, pressed && styles.pressed]}>
                      <View style={[styles.check, checked ? { backgroundColor: theme.tint, borderColor: theme.tint }
                        : { borderColor: theme.borderStrong }]}>
                        {checked ? <Icon name="checkmark" size={12} weight="bold" color={theme.onTint} /> : null}
                      </View>
                      <ThemedText style={{ color }}>{label}</ThemedText>
                    </Pressable>
                  ) : (
                    // Already has a dinner, or one is on its way: shown so the week reads whole, but not offered.
                    <View accessible accessibilityLabel={`${label}, ${t(incoming[day.date] ? 'weekPlanning.dayIncoming' : 'weekPlanning.dayPlanned')}`}
                      style={[styles.dayToggle, styles.unavailable]}>
                      <View style={styles.check}>
                        <Icon name={incoming[day.date] ? 'sparkles' : 'fork.knife'} size={13} color={theme.textSecondary} />
                      </View>
                      <ThemedText style={[styles.fill, { color }]}>{label}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {t(incoming[day.date] ? 'weekPlanning.dayIncoming' : 'weekPlanning.dayPlanned')}
                      </ThemedText>
                    </View>
                  )}
                  {checked ? (
                    <Stepper compact value={servingsFor(day.date)} accessibilityLabel={`${t('weekPlanning.servings')}, ${label}`}
                      onChange={(value) => setServingsByDate((current) => ({ ...current, [day.date]: value }))} />
                  ) : null}
                </View>
              </View>
            );
          }) : null}
        </SuggestionSettings>
      </ScrollView>
      <View style={styles.footer}>
        <Button disabled={!canStart} onPress={start}
          title={!dates.length ? t('weekPlanning.noneSelected')
            : shown === 1 ? t('weekPlanning.generateOne') : t('weekPlanning.generate', { count: shown })} />
        {ai ? <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{t('weekPlanning.privacy')}</ThemedText> : null}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  intro: { textAlign: 'center', marginTop: -Spacing.two, paddingHorizontal: Spacing.three },
  fill: { flex: 1 },
  content: { gap: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.three },
  pressed: { opacity: 0.6 },
  row: settingStyles.row,
  dayRow: { minHeight: 48, paddingRight: Spacing.one },
  dayToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 48 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  unavailable: { paddingRight: Spacing.three },
  // Starts under the day's name, past the tick.
  daySeparator: { marginLeft: Spacing.three + 22 + Spacing.three },
  footer: { gap: Spacing.two },
});
