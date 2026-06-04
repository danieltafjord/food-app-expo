import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DinnerPicker } from '@/components/dinner-picker';
import { EntryEditor, type EntryEdit } from '@/components/entry-editor';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WeekBoard } from '@/components/week-board';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { setPlannerWeekKey, usePlannerWeekKey } from '@/lib/planner-state';
import {
  createPlanEntry,
  deletePlanEntry,
  ensurePlanForWeek,
  updatePlanEntry,
  useLocale,
  usePlanEntries,
  usePlanForWeek,
  type DinnerWithItems,
  type PlanEntryWithDinner,
} from '@/lib/store';
import {
  addDays,
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
  const [pickerDate, setPickerDate] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<PlanEntryWithDinner | null>(null);

  const days = buildWeek(weekStart, locale);
  const weekEndKey = toDateKey(addDays(weekStart, 6));
  const label = weekLabel(weekStart, locale);
  const isCurrentWeek = weekStartKey === toDateKey(startOfWeek(new Date()));

  const currentPlan = usePlanForWeek(weekStartKey);
  const entries = usePlanEntries(currentPlan?.id);

  const entriesByDate: Record<string, PlanEntryWithDinner[]> = {};
  for (const entry of entries) {
    const key = dateKeyOf(entry.scheduled_date);
    (entriesByDate[key] ??= []).push(entry);
  }

  // Create the week's plan lazily, the first time a dinner is added to it.
  function onPickDinner(dinner: DinnerWithItems) {
    if (!pickerDate) {
      return;
    }
    const planId = ensurePlanForWeek(weekStartKey, weekEndKey, t('plans.weekOf', { label }));
    createPlanEntry(planId, {
      dinner_id: dinner.id,
      scheduled_date: pickerDate,
      servings: dinner.default_servings,
      meal_type: 'dinner',
    });
    setPickerDate(null);
  }

  function onMove(entryId: string, toDate: string) {
    updatePlanEntry(entryId, { scheduled_date: toDate });
  }

  function onEditEntry(entryId: string) {
    setEditingEntry(entries.find((e) => e.id === entryId) ?? null);
  }

  function onSaveEntry(entry: PlanEntryWithDinner, edit: EntryEdit) {
    updatePlanEntry(entry.id, { servings: edit.servings });
    setEditingEntry(null);
  }

  function onRemoveEntry(entry: PlanEntryWithDinner) {
    deletePlanEntry(entry.id);
    setEditingEntry(null);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.weekNav}>
            <NavButton
              label="‹"
              onPress={() => setPlannerWeekKey(toDateKey(addWeeks(weekStart, -1)))}
            />
            <View style={styles.weekLabel}>
              <Pressable
                onPress={() => router.push('/weeks')}
                hitSlop={8}
                style={({ pressed }) => [styles.weekLabelButton, pressed && styles.pressed]}>
                <ThemedText type="smallBold">{label}</ThemedText>
                <SymbolView
                  name="chevron.down"
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
              onPress={() => setPlannerWeekKey(toDateKey(addWeeks(weekStart, 1)))}
            />
          </View>
        </View>

        <View style={styles.boardArea}>
          <WeekBoard
            days={days}
            entriesByDate={entriesByDate}
            onMove={onMove}
            onAdd={setPickerDate}
            onEdit={onEditEntry}
          />
        </View>
      </SafeAreaView>

      <DinnerPicker
        visible={pickerDate !== null}
        date={pickerDate}
        onClose={() => setPickerDate(null)}
        onPick={onPickDinner}
      />

      <EntryEditor
        entry={editingEntry}
        onClose={() => setEditingEntry(null)}
        onSave={onSaveEntry}
        onRemove={onRemoveEntry}
      />
    </ThemedView>
  );
}

function NavButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
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
