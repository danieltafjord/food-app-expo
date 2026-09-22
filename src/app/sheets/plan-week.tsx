import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { SheetScreen } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { useLocale } from '@/lib/store/settings';
import {
  applyWeekDraft,
  getWeekPlanningContext,
  suggestWeek,
  useWeekPlanningContext,
} from '@/lib/store/week-planning';
import { buildWeek, fromDateKey, startOfWeek, toDateKey, weekLabel } from '@/lib/week';

export default function PlanWeekSheet() {
  const { weekStart } = useLocalSearchParams<{ weekStart: string }>();
  const t = useT();
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)
    || toDateKey(startOfWeek(fromDateKey(weekStart))) !== weekStart) {
    return (
      <SheetScreen title={t('weekPlanning.title')}>
        <Button title={t('common.back')} onPress={() => router.back()} />
      </SheetScreen>
    );
  }
  return <WeekPreview key={weekStart} weekStart={weekStart} />;
}

function WeekPreview({ weekStart }: { weekStart: string }) {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  const context = useWeekPlanningContext(weekStart);
  const [draft, setDraft] = useState(() => suggestWeek(context));
  const [saveRejected, setSaveRejected] = useState(false);
  const saved = useRef(false);
  const days = buildWeek(fromDateKey(weekStart), locale);
  const stale = saveRejected || draft?.contextKey !== context.key;
  const canPlan = context.dates.length > 0 && context.missing === 0;
  const canShuffle = context.dates.length > 1 || context.candidates.length > 1;

  function shuffle() {
    setDraft(suggestWeek(getWeekPlanningContext(weekStart), draft));
    setSaveRejected(false);
  }

  function save() {
    if (!draft || saved.current) return;
    if (!applyWeekDraft(draft, t('plans.weekOf', { label: weekLabel(fromDateKey(weekStart), locale) }))) {
      setSaveRejected(true);
      return;
    }
    saved.current = true;
    router.back();
  }

  return (
    <SheetScreen title={t('weekPlanning.title')} layout="fill">
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        {weekLabel(fromDateKey(weekStart), locale)}
      </ThemedText>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {!canPlan ? (
          <ThemedText themeColor="textSecondary">
            {context.missing > 0
              ? t(context.missing === 1 ? 'weekPlanning.needOne' : 'weekPlanning.needMore', { count: context.missing })
              : t('weekPlanning.noEmptyDays')}
          </ThemedText>
        ) : stale ? (
          <ThemedText accessibilityLiveRegion="polite" themeColor="textSecondary">
            {t('weekPlanning.changed')}
          </ThemedText>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              {t('weekPlanning.previewHint')}
            </ThemedText>
            {draft?.entries.map((entry) => {
              const day = days.find((item) => item.date === entry.date)!;
              return (
                <View key={entry.date} style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
                  <View style={styles.date}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.weekday}>
                      {day.weekday}
                    </ThemedText>
                    <ThemedText type="smallBold">{day.dayOfMonth}</ThemedText>
                  </View>
                  <View style={styles.dinner}>
                    <ThemedText type="smallBold">{entry.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {entry.servings} {t('common.servings')}
                    </ThemedText>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
      <View style={styles.actions}>
        {canPlan && stale ? (
          <Button title={t('weekPlanning.refresh')} onPress={shuffle} />
        ) : canPlan ? (
          <View style={styles.planActions}>
            {canShuffle ? (
              <Button title={t('weekPlanning.shuffle')} variant="secondary" onPress={shuffle} style={styles.action} />
            ) : null}
            <Button title={t('weekPlanning.usePlan')} onPress={save} style={styles.action} />
          </View>
        ) : null}
        <Button title={t('common.cancel')} variant="secondary" onPress={() => router.back()} />
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  scroll: { flex: 1 },
  content: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  date: { minWidth: 40, alignItems: 'center' },
  weekday: { textTransform: 'capitalize' },
  dinner: { flex: 1, gap: Spacing.half },
  actions: { gap: Spacing.two },
  planActions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
