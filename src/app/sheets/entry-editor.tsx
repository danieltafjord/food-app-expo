import { useValue } from '@legendapp/state/react';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { DinnerImage } from '@/components/dinner-image';
import { Icon, type IconName } from '@/components/icon';
import { SheetScreen } from '@/components/sheet';
import { Stepper } from '@/components/stepper';
import { ThemedText } from '@/components/themed-text';
import { BadgeColors, Spacing } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { suggestDinners, useSuggestionFailure, useSwapInProgress } from '@/lib/dinner-suggester';
import { weekdayWithDay } from '@/lib/format';
import { hapticSelection } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { pushOnce } from '@/lib/navigation';
import {
  deletePlanEntry,
  updatePlanEntry,
  useLocale,
  usePlanEntry,
  type PlanEntryWithDinner,
} from '@/lib/store';
import { store$ } from '@/lib/store/collections';
import { releaseSuggestedDinner } from '@/lib/store/week-suggestions';
import { deleteWithUndo } from '@/lib/undo';
import { buildWeek, dateKeyOf, fromDateKey, startOfWeek } from '@/lib/week';

/**
 * A scheduled dinner (`entryId`). Everything here saves as you go, like the
 * rest of the board: the servings stepper writes on each tap, the day chips
 * move the dinner (dragging the card on the board does the same), "Suggest
 * another" swaps in a new idea for the day (the sheet stays open, so it can be
 * tapped again until one sticks), "Edit dinner" opens the recipe itself, and
 * "Add another dinner" opens the picker for the same day. Removing the dinner
 * from the plan is a separate red action below a divider, with Undo.
 */
export default function EntryEditorSheet() {
  const t = useT();
  const { entryId } = useLocalSearchParams<{ entryId: string }>();
  const entry = usePlanEntry(entryId);

  // Gone (deleted on another device while open): nothing to edit.
  if (!entry) {
    return (
      <SheetScreen title={t('common.dinnerFallback')}>
        <Button title={t('common.back')} variant="secondary" onPress={() => router.back()} />
      </SheetScreen>
    );
  }
  return <EntryForm key={entry.id} entry={entry} />;
}

function EntryForm({ entry }: { entry: PlanEntryWithDinner }) {
  const t = useT();
  const theme = useTheme();
  const warning = BadgeColors[useResolvedScheme()].warning;
  const locale = useLocale();

  const scheduled = dateKeyOf(entry.scheduled_date);
  const days = buildWeek(startOfWeek(fromDateKey(scheduled)), locale);
  const noIngredients = entry.ingredient_count === 0;
  const swapping = useSwapInProgress(entry.id);
  const failure = useSuggestionFailure();
  const failed = failure?.job.kind === 'swap' && failure.job.entryId === entry.id ? failure.message : null;
  const fromSaved = useValue(() => store$.meta.planningPreferences.get()?.source === 'saved');
  // Every action below closes the sheet: once per sheet, or a double tap pops
  // the screen beneath it too.
  const leaving = useRef(false);

  function leave(): boolean {
    if (leaving.current) return false;
    leaving.current = true;
    return true;
  }

  function moveTo(date: string) {
    if (date === scheduled || !leave()) return;
    hapticSelection();
    updatePlanEntry(entry.id, { scheduled_date: date });
    router.back();
  }

  function editDinner() {
    if (!leave()) return;
    // Leave the sheet, then push the recipe over the tabs (not onto the Dinners
    // tab), so Back returns to the plan.
    router.back();
    pushOnce({ pathname: '/dinner/[id]', params: { id: entry.dinner_id } });
  }

  function addAnother() {
    if (!leave()) return;
    // Leave the sheet, then open the picker for this dinner's day.
    router.back();
    pushOnce({ pathname: '/sheets/dinner-picker', params: { date: scheduled } });
  }

  function suggestAnother() {
    if (swapping) return;
    hapticSelection();
    void suggestDinners({ kind: 'swap', entryId: entry.id });
  }

  // Off the board at once; written when the Undo window closes, so an undone
  // removal leaves no trace (and a suggested dinner isn't deleted meanwhile).
  function remove() {
    if (!leave()) return;
    const { id, dinner_id: dinnerId } = entry;
    router.back();
    deleteWithUndo(t('undo.dinnerRemoved', { name: entry.dinner_name ?? t('common.dinnerFallback') }), [id], () => {
      deletePlanEntry(id);
      // A suggestion nobody kept doesn't linger in the household's dinners.
      releaseSuggestedDinner(dinnerId, scheduled);
    });
  }

  const current = days.find((day) => day.date === scheduled);

  return (
    <SheetScreen>
      <View style={styles.header}>
        <DinnerImage dinnerId={entry.dinner_id} name={entry.dinner_name} size={48} />
        <View style={styles.headerText}>
          <ThemedText type="subtitle" numberOfLines={2} style={styles.title}>
            {entry.dinner_name ?? t('common.dinnerFallback')}
          </ThemedText>
          {current ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.capitalize}>
              {weekdayWithDay(current.weekday, current.dayOfMonth, locale)}
            </ThemedText>
          ) : null}
        </View>
      </View>

      <View style={[styles.group, styles.servingsRow, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText style={styles.rowTitle}>{t('entryEditor.servings')}</ThemedText>
        <Stepper
          compact
          value={entry.servings}
          onChange={(servings) => updatePlanEntry(entry.id, { servings })}
          min={1}
          max={99}
          accessibilityLabel={t('entryEditor.servings')}
        />
      </View>

      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{t('entryEditor.moveTo')}</ThemedText>
        <View style={styles.days}>
          {days.map((day) => {
            const selected = day.date === scheduled;
            return (
              <Pressable
                key={day.date}
                onPress={() => moveTo(day.date)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={weekdayWithDay(day.weekday, day.dayOfMonth, locale)}
                style={({ pressed }) => [
                  styles.day,
                  { backgroundColor: selected ? theme.tint : theme.backgroundElement },
                  pressed && !selected && styles.pressed,
                ]}>
                <ThemedText
                  type="small"
                  style={[styles.capitalize, selected && { color: theme.onTint }]}
                  themeColor={selected ? undefined : 'textSecondary'}>
                  {day.weekday}
                </ThemedText>
                <ThemedText
                  type="smallBold"
                  style={[
                    selected && { color: theme.onTint },
                    // Today in the brand accent, like the board (the text-safe shade).
                    !selected && day.isToday && { color: theme.accentText },
                  ]}>
                  {day.dayOfMonth}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.group, { backgroundColor: theme.backgroundElement }]}>
        <LinkRow
          icon="sparkles"
          title={t('entryEditor.suggestAnother')}
          hint={swapping ? t('entryEditor.swapping') : failed ? t(failed)
            : t(fromSaved ? 'entryEditor.suggestSavedHint' : 'entryEditor.suggestAnotherHint')}
          warning={failed && !swapping ? theme.danger : undefined}
          busy={swapping}
          onPress={suggestAnother}
        />
        <View style={[styles.separator, { backgroundColor: theme.border }]} />
        <LinkRow
          icon="fork.knife"
          title={t('entryEditor.editDinner')}
          hint={noIngredients ? t('entryEditor.noIngredientsHint') : t('entryEditor.editDinnerHint')}
          warning={noIngredients ? warning.fg : undefined}
          onPress={editDinner}
        />
        <View style={[styles.separator, { backgroundColor: theme.border }]} />
        <LinkRow
          icon="plus"
          title={t('entryEditor.addAnother')}
          hint={t('entryEditor.addAnotherHint')}
          onPress={addAnother}
        />
      </View>

      <Pressable
        onPress={remove}
        accessibilityRole="button"
        style={({ pressed }) => [styles.group, styles.removeRow, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
        <ThemedText style={[styles.rowTitle, { color: theme.danger }]}>{t('entryEditor.remove')}</ThemedText>
      </Pressable>
    </SheetScreen>
  );
}

/** One tappable row in a grouped card: leading icon, title and hint, chevron (a spinner while busy). */
function LinkRow({ icon, title, hint, warning, busy = false, onPress }: {
  icon: IconName; title: string; hint: string; warning?: string; busy?: boolean; onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityHint={hint}
      accessibilityState={{ busy, disabled: busy }}
      style={({ pressed }) => [styles.linkRow, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <View style={[styles.linkIcon, { backgroundColor: theme.backgroundSelected }]}>
        <Icon name={icon} size={14} color={theme.text} />
      </View>
      <View style={styles.linkText}>
        <ThemedText style={styles.rowTitle}>{title}</ThemedText>
        <View style={styles.hint}>
          {warning ? <Icon name="exclamationmark.triangle.fill" size={10} color={warning} /> : null}
          <ThemedText type="small" themeColor={warning ? undefined : 'textSecondary'}
            style={[styles.hintText, warning ? { color: warning } : undefined]}>
            {hint}
          </ThemedText>
        </View>
      </View>
      {busy ? <ActivityIndicator size="small" color={theme.textSecondary} />
        : <Icon name="chevron.right" size={13} color={theme.textSecondary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  headerText: {
    flex: 1,
    gap: Spacing.half,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
  },
  capitalize: {
    textTransform: 'capitalize',
  },
  // Every card shares one radius and inset so their edges and text line up.
  group: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  servingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    minHeight: 56,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
  },
  rowTitle: {
    fontWeight: 600,
  },
  field: {
    gap: Spacing.two,
  },
  fieldLabel: {
    paddingHorizontal: Spacing.three,
  },
  days: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  day: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.half,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 60,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
  },
  linkIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    flex: 1,
    gap: Spacing.half,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  hintText: {
    flexShrink: 1,
  },
  // Inset to start under the row text, past the icon.
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three + 30 + Spacing.three,
  },
  removeRow: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
