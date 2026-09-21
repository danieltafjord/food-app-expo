import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { SheetScreen } from '@/components/sheet';
import { Stepper } from '@/components/stepper';
import { ThemedText } from '@/components/themed-text';
import { BadgeColors, Spacing } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
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
import { buildWeek, dateKeyOf, fromDateKey, startOfWeek } from '@/lib/week';

/**
 * A scheduled dinner (`entryId`). Everything here saves as you go, like the
 * rest of the board: the servings stepper writes on each tap, the day chips
 * move the dinner (dragging the card on the board does the same), and the
 * "Edit dinner" row opens the recipe itself, and "Add another dinner" opens the
 * picker for the same day. Removing the dinner from the
 * plan is a separate red action below a divider.
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

  function moveTo(date: string) {
    if (date === scheduled) return;
    hapticSelection();
    updatePlanEntry(entry.id, { scheduled_date: date });
    router.back();
  }

  function editDinner() {
    // Leave the sheet, then push the recipe onto the Dinners tab.
    router.back();
    pushOnce({ pathname: '/dinners/[id]', params: { id: entry.dinner_id } });
  }

  function addAnother() {
    // Leave the sheet, then open the picker for this dinner's day.
    router.back();
    pushOnce({ pathname: '/sheets/dinner-picker', params: { date: scheduled } });
  }

  function remove() {
    deletePlanEntry(entry.id);
    router.back();
  }

  return (
    <SheetScreen title={entry.dinner_name ?? t('common.dinnerFallback')}>
      <View style={styles.field}>
        <ThemedText type="smallBold">{t('entryEditor.servings')}</ThemedText>
        <Stepper
          value={entry.servings}
          onChange={(servings) => updatePlanEntry(entry.id, { servings })}
          min={1}
          max={99}
          accessibilityLabel={t('entryEditor.servings')}
        />
      </View>

      <View style={styles.field}>
        <ThemedText type="smallBold">{t('entryEditor.moveTo')}</ThemedText>
        <View style={styles.days}>
          {days.map((day) => {
            const selected = day.date === scheduled;
            return (
              <Pressable
                key={day.date}
                onPress={() => moveTo(day.date)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${day.weekday} ${day.dayOfMonth}`}
                style={({ pressed }) => [
                  styles.day,
                  { backgroundColor: selected ? theme.tint : theme.backgroundElement },
                  pressed && !selected && styles.pressed,
                ]}>
                <ThemedText
                  type="small"
                  style={[styles.dayName, selected && { color: theme.onTint }]}
                  themeColor={selected ? undefined : 'textSecondary'}>
                  {day.weekday}
                </ThemedText>
                <ThemedText
                  type="smallBold"
                  style={[
                    selected && { color: theme.onTint },
                    !selected && day.isToday && { color: theme.tint },
                  ]}>
                  {day.dayOfMonth}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Pressable
        onPress={editDinner}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.link,
          { backgroundColor: noIngredients ? warning.bg : theme.backgroundElement },
          pressed && styles.pressed,
        ]}>
        <View style={styles.linkText}>
          <ThemedText type="smallBold" style={noIngredients ? { color: warning.fg } : undefined}>
            {t('entryEditor.editDinner')}
          </ThemedText>
          <ThemedText
            type="small"
            themeColor={noIngredients ? undefined : 'textSecondary'}
            style={noIngredients ? { color: warning.fg } : undefined}>
            {noIngredients ? t('entryEditor.noIngredientsHint') : t('entryEditor.editDinnerHint')}
          </ThemedText>
        </View>
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={13}
          tintColor={noIngredients ? warning.fg : theme.textSecondary}
          type="monochrome"
        />
      </Pressable>

      <Pressable
        onPress={addAnother}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.link,
          { backgroundColor: theme.backgroundElement },
          pressed && styles.pressed,
        ]}>
        <View style={styles.linkText}>
          <ThemedText type="smallBold">{t('entryEditor.addAnother')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('entryEditor.addAnotherHint')}
          </ThemedText>
        </View>
        <SymbolView
          name={{ ios: 'plus', android: 'add', web: 'add' }}
          size={13}
          tintColor={theme.textSecondary}
          type="monochrome"
        />
      </Pressable>

      <View style={[styles.divider, { backgroundColor: theme.border }]} />

      <Button title={t('entryEditor.remove')} variant="danger" onPress={remove} />
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
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
    borderRadius: Spacing.two,
  },
  dayName: {
    textTransform: 'capitalize',
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  linkText: {
    flex: 1,
    gap: Spacing.half,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.one,
  },
  pressed: {
    opacity: 0.6,
  },
});
