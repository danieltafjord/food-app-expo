import { useValue } from '@legendapp/state/react';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { SheetScreen } from '@/components/sheet';
import { Stepper } from '@/components/stepper';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api/client';
import { formatQuantity } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { pushOnce } from '@/lib/navigation';
import { store$ } from '@/lib/store/collections';
import { useHouseholdDefaultServings } from '@/lib/store/household';
import { useLocale } from '@/lib/store/settings';
import { suggestWeek } from '@/lib/store/week-planning';
import { acceptSuggestedWeek, getSuggestionContext, type SuggestedWeekDraft } from '@/lib/store/week-suggestions';
import { buildWeek, fromDateKey, startOfWeek, toDateKey, weekLabel } from '@/lib/week';
import { mealNameKey, PLANNING_SHORTCUTS, requestWeekSuggestions, type PlanningPreferences, type SuggestedDinner } from '@/lib/week-suggestions';

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

function WeekPlanner({ weekStart }: { weekStart: string }) {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  const householdServings = useHouseholdDefaultServings();
  const preferences = useValue(store$.meta.planningPreferences);
  const context = useValue(() => getSuggestionContext(weekStart));
  const defaultServings = preferences?.servings ?? householdServings;
  const [servingsByDate, setServingsByDate] = useState<Record<string, number>>({});
  const servingsFor = (date: string) => servingsByDate[date] ?? defaultServings;
  const [selected, setSelected] = useState(context.dates);
  const [draft, setDraft] = useState<SuggestedWeekDraft | null>(null);
  const [editing, setEditing] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveRejected, setSaveRejected] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const saved = useRef(false);
  useEffect(() => () => activeRequest.current?.abort(), []);
  const days = buildWeek(fromDateKey(weekStart), locale);
  const dates = selected.filter((date) => context.dates.includes(date));
  const excluded = preferences?.excluded ?? [];
  const excludedKeys = new Set(excluded.map(mealNameKey));
  const eligible = context.recipes.filter((recipe) => !excludedKeys.has(mealNameKey(recipe.name)));
  const stale = saveRejected || (!!draft && draft.contextKey !== context.key);
  const hasRejected = draft?.entries.some(({ dinner }) => excludedKeys.has(mealNameKey(dinner.name)));

  function remember(patch: Partial<PlanningPreferences>) {
    const current = store$.meta.planningPreferences.get() ?? { text: '', shortcuts: [], excluded: [] };
    store$.meta.planningPreferences.set({ ...current, ...patch });
  }

  async function generate(date?: string, disliked?: string) {
    if (activeRequest.current) return;
    Keyboard.dismiss();
    const live = getSuggestionContext(weekStart);
    const requestDates = date ? [date] : selected.filter((value) => live.dates.includes(value));
    if (!requestDates.length || (date && draft?.contextKey !== live.key)) {
      setError(t('weekPlanning.changed'));
      return;
    }
    const hiddenNames = disliked ? [...new Set([...excluded, disliked])].slice(-40) : excluded;
    const servings = usualServings(requestDates.map(servingsFor), defaultServings);
    remember({ servings, excluded: hiddenNames });
    const available = live.recipes.filter((recipe) => recipe.name.length <= 120 && recipe.ingredients.length <= 20
      && recipe.ingredients.every((item) => item.name.length <= 120)
      && !hiddenNames.some((name) => mealNameKey(name) === mealNameKey(recipe.name)))
      .slice(0, 20);
    const availableIds = new Set(available.map((recipe) => recipe.existingId));
    // Already planned, incomplete and hidden recipes must not return as newly generated duplicates.
    const excludedNames = [...new Set([
      ...hiddenNames,
      ...(date ? draft?.entries.map(({ dinner }) => dinner.name) ?? [] : []),
      ...live.allNames.filter((name) => !available.some((recipe) => mealNameKey(recipe.name) === mealNameKey(name))),
    ])].filter((name) => name.length <= 120).slice(0, 60);
    const blocked = new Set(excludedNames.map(mealNameKey));
    const request = new AbortController();
    activeRequest.current = request;
    setBusy(date ?? 'all');
    setError(null);
    try {
      const suggestions = await requestWeekSuggestions({
        count: requestDates.length, servings, locale, preferences: preferences?.text.trim() ?? '',
        shortcuts: preferences?.shortcuts ?? [], exclude: excludedNames,
        available: available.filter((recipe) => !blocked.has(mealNameKey(recipe.name))).map((recipe) => ({
          id: recipe.existingId!, name: recipe.name, category: recipe.category,
          ingredients: recipe.ingredients.map((item) => item.name),
        })),
      }, live.recipes.filter((recipe) => availableIds.has(recipe.existingId)), request.signal);
      if (request.signal.aborted) return;
      if (getSuggestionContext(weekStart).key !== live.key) {
        setSaveRejected(true);
        setError(t('weekPlanning.changed'));
        return;
      }
      const entries = date && draft
        ? draft.entries.map((entry) => entry.date === date ? { ...entry, dinner: suggestions[0] } : entry)
        : requestDates.map((value, index) => ({ date: value, dinner: suggestions[index], servings: servingsFor(value) }));
      setDraft({ weekStart, contextKey: live.key, entries });
      setSaveRejected(false);
      setEditing(false);
    } catch (cause) {
      if (request.signal.aborted) return;
      const code = cause instanceof ApiError ? (cause.body as { code?: string } | undefined)?.code : null;
      setError(t(code === 'daily_limit' ? 'weekPlanning.limited' : cause instanceof ApiError && cause.status === 429
        ? 'weekPlanning.busy' : code === 'unavailable' ? 'weekPlanning.unavailable' : 'weekPlanning.failed'));
    } finally {
      if (activeRequest.current === request) {
        activeRequest.current = null;
        if (!request.signal.aborted) setBusy(null);
      }
    }
  }

  function useSavedDinners() {
    const ids = new Set(eligible.map((recipe) => recipe.existingId));
    const candidates = context.candidates.filter((candidate) => ids.has(candidate.id));
    const suggestion = suggestWeek({ ...context, dates, candidates, missing: Math.max(0, dates.length - candidates.length) });
    if (!suggestion) return;
    remember({ servings: usualServings(dates.map(servingsFor), defaultServings) });
    setDraft({ weekStart, contextKey: context.key, entries: suggestion.entries.map((entry) => ({
      date: entry.date, dinner: eligible.find((recipe) => recipe.existingId === entry.dinnerId)!, servings: servingsFor(entry.date),
    })) });
    setSaveRejected(false);
    setError(null);
    setEditing(false);
  }

  function save() {
    if (!draft || saved.current || activeRequest.current || hasRejected) return;
    const listId = acceptSuggestedWeek(draft, t('plans.weekOf', { label: weekLabel(fromDateKey(weekStart), locale) }));
    if (!listId) { setSaveRejected(true); return; }
    saved.current = true;
    router.back();
    pushOnce({ pathname: '/shopping/[id]', params: { id: listId } });
  }

  return (
    <SheetScreen title={t('weekPlanning.title')} layout="fill">
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{weekLabel(fromDateKey(weekStart), locale)}</ThemedText>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {context.dates.length === 0 ? <ThemedText>{t('weekPlanning.noEmptyDays')}</ThemedText> : editing ? (
          <>
            <TextField label={t('weekPlanning.preferences')} accessibilityLabel={t('weekPlanning.preferences')}
              placeholder={t('weekPlanning.placeholder')} multiline maxLength={600} editable={!busy}
              value={preferences?.text ?? ''} onChangeText={(text) => remember({ text })} style={styles.input} />
            <ThemedText type="small" themeColor="textSecondary">{t('weekPlanning.optional')}</ThemedText>
            <View style={styles.chips}>
              {PLANNING_SHORTCUTS.map((value) => {
                const checked = preferences?.shortcuts.includes(value);
                return <Pressable key={value} accessibilityRole="checkbox" accessibilityState={{ checked: !!checked, disabled: !!busy }} disabled={!!busy}
                  onPress={() => remember({ shortcuts: checked ? preferences.shortcuts.filter((item) => item !== value) : [...(preferences?.shortcuts ?? []), value] })}
                  style={[styles.chip, { backgroundColor: checked ? theme.tint : theme.backgroundElement }]}>
                  <ThemedText type="small" style={{ color: checked ? theme.onTint : theme.text }}>{t(`weekPlanning.${value}`)}</ThemedText>
                </Pressable>;
              })}
            </View>
            <View style={styles.dayHeader}>
              <ThemedText type="smallBold">{t('weekPlanning.days')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t('weekPlanning.servings')}</ThemedText>
            </View>
            <View style={[styles.dayList, { backgroundColor: theme.backgroundElement }]}>
              {days.filter((day) => context.dates.includes(day.date)).map((day, index) => {
                const checked = dates.includes(day.date);
                const label = `${day.weekday} ${day.dayOfMonth}.`;
                return <View key={day.date} style={[styles.dayRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !!busy }} accessibilityLabel={label}
                    disabled={!!busy} hitSlop={{ top: 6, bottom: 6 }}
                    onPress={() => setSelected((current) => checked ? current.filter((value) => value !== day.date) : [...current, day.date].sort())}
                    style={styles.dayToggle}>
                    <View style={[styles.check, checked ? { backgroundColor: theme.tint, borderColor: theme.tint } : { borderColor: theme.borderStrong }]}>
                      {checked ? <Icon name="checkmark" size={12} weight="bold" color={theme.onTint} /> : null}
                    </View>
                    <ThemedText style={{ color: checked ? theme.text : theme.textSecondary }}>{label}</ThemedText>
                  </Pressable>
                  {checked ? <Stepper compact value={servingsFor(day.date)} accessibilityLabel={`${t('weekPlanning.servings')}, ${label}`}
                    onChange={(value) => { if (!activeRequest.current) setServingsByDate((current) => ({ ...current, [day.date]: value })); }} /> : null}
                </View>;
              })}
            </View>
            {!dates.length ? <ThemedText type="small">{t('weekPlanning.noneSelected')}</ThemedText> : null}
            <ThemedText type="small" themeColor="textSecondary">{t('weekPlanning.privacy')}</ThemedText>
            {eligible.length >= dates.length && dates.length > 0 ? <>
              <Button title={t('weekPlanning.savedMeals')} variant="secondary" disabled={!!busy} onPress={useSavedDinners} />
              <ThemedText type="small" themeColor="textSecondary">{t('weekPlanning.savedHint')}</ThemedText>
            </> : null}
            {excluded.length > 0 ? <Button size="small" variant="secondary" disabled={!!busy}
              title={t('weekPlanning.resetExcluded', { count: excluded.length })} onPress={() => remember({ excluded: [] })} /> : null}
          </>
        ) : (
          <>
            <ThemedText type="smallBold">{t('weekPlanning.preview')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{t('weekPlanning.previewDetails')}</ThemedText>
            {draft?.entries.map(({ date, dinner }) => {
              const day = days.find((item) => item.date === date)!;
              const servings = draft.entries.find((entry) => entry.date === date)!.servings;
              return <DinnerPreview key={date} dinner={dinner} servings={servings} day={`${day.weekday} ${day.dayOfMonth}.`}
                onServings={(value) => {
                  setDraft({ ...draft, entries: draft.entries.map((entry) => entry.date === date ? { ...entry, servings: value } : entry) });
                  setServingsByDate((current) => ({ ...current, [date]: value }));
                }}
                disabled={!!busy || stale} swapping={busy === date}
                onSwap={() => { void generate(date); }} onDislike={() => { void generate(date, dinner.name); }}
                onRemove={() => { setDraft({ ...draft, entries: draft.entries.filter((entry) => entry.date !== date) }); setSelected((current) => current.filter((value) => value !== date)); }} />;
            })}
            <Button title={t('weekPlanning.editPreferences')} variant="secondary" disabled={!!busy} onPress={() => { setEditing(true); setError(null); }} />
          </>
        )}
        {busy ? <ThemedText accessibilityLiveRegion="polite" type="small" themeColor="textSecondary">{t(busy === 'all' ? 'weekPlanning.generating' : 'weekPlanning.swapping')}</ThemedText> : null}
        {error ? <ThemedText accessibilityLiveRegion="polite" type="small" style={{ color: theme.danger }}>{error}</ThemedText> : null}
        {!editing && stale ? <ThemedText accessibilityLiveRegion="polite">{t('weekPlanning.changed')}</ThemedText> : null}
        {!editing && hasRejected ? <ThemedText type="small">{t('weekPlanning.rejected')}</ThemedText> : null}
      </ScrollView>
      {context.dates.length > 0 ? editing ? (
        <Button title={t(error ? 'error.retry' : 'weekPlanning.generate')} loading={busy === 'all'} disabled={!!busy || !dates.length}
          onPress={() => { void generate(); }} />
      ) : stale ? (
        <Button title={t('weekPlanning.refresh')} onPress={() => { setEditing(true); setSaveRejected(false); }} />
      ) : <View style={styles.actions}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{t('weekPlanning.saveHint')}</ThemedText>
        <Button title={t('weekPlanning.usePlan')} disabled={!!busy || !draft?.entries.length || hasRejected} onPress={save} />
      </View> : null}
      <Button title={t('common.cancel')} variant="secondary" onPress={() => router.back()} />
    </SheetScreen>
  );
}

/** The number of servings most selected days use; new recipes are written for it. */
function usualServings(values: number[], fallback: number): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = fallback;
  for (const [value, count] of counts) if (count > (counts.get(best) ?? 0)) best = value;
  return best;
}

function DinnerPreview({ dinner, servings, day, disabled, swapping, onSwap, onRemove, onDislike, onServings }: {
  dinner: SuggestedDinner; servings: number; day: string; disabled: boolean; swapping: boolean;
  onSwap: () => void; onRemove: () => void; onDislike: () => void; onServings: (value: number) => void;
}) {
  const t = useT();
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  return <View style={[styles.recipe, { backgroundColor: theme.backgroundElement }]}>
    <View style={styles.previewDay} pointerEvents={disabled ? 'none' : 'auto'}>
      <ThemedText type="small" themeColor="textSecondary">{day} · {t('common.servings')}</ThemedText>
      <Stepper compact value={servings} onChange={onServings} accessibilityLabel={`${t('weekPlanning.servings')}, ${day}`} />
    </View>
    <ThemedText type="smallBold">{dinner.name}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{t(dinner.existingId ? 'weekPlanning.savedRecipe' : 'weekPlanning.newRecipe')}</ThemedText>
    <View style={styles.chips}>
      <Button size="small" variant="secondary" title={t('weekPlanning.swap')} accessibilityLabel={`${t('weekPlanning.swap')} ${dinner.name}`} disabled={disabled} loading={swapping} onPress={onSwap} />
      <Button size="small" variant="secondary" title={t('weekPlanning.removeDay')} accessibilityLabel={`${t('weekPlanning.removeDay')}: ${day}`} disabled={disabled} onPress={onRemove} />
    </View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.details}>
      <ThemedText type="small" style={{ color: theme.tint }}>{t('weekPlanning.details')} {expanded ? '−' : '+'}</ThemedText>
    </Pressable>
    {expanded ? <View style={styles.actions}>
      {dinner.ingredients.map((item, index) => <ThemedText key={index} type="small">
        {formatQuantity(Math.round(item.quantity * servings / dinner.baseServings * 100) / 100, item.unit)} {item.name}
      </ThemedText>)}
      {dinner.notes ? <ThemedText type="small">{dinner.notes}</ThemedText> : null}
      <Button title={t('weekPlanning.dislike')} size="small" variant="secondary" disabled={disabled} onPress={onDislike} />
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' }, scroll: { flex: 1 }, content: { gap: Spacing.three, paddingBottom: Spacing.three },
  input: { minHeight: 96, paddingVertical: Spacing.three, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { minHeight: 44, justifyContent: 'center', borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: Spacing.two, marginBottom: -Spacing.one },
  dayList: { borderRadius: Spacing.three, overflow: 'hidden' },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 52, paddingLeft: Spacing.three, paddingRight: Spacing.two },
  dayToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 52 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  previewDay: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  recipe: { padding: Spacing.three, gap: Spacing.two, borderRadius: Spacing.three },
  details: { minHeight: 44, justifyContent: 'center' }, actions: { gap: Spacing.two },
});
