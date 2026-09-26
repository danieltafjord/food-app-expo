import { useDinnerCategoryLabel } from '@/lib/store/dinner-categories';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Button } from '@/components/button';
import { DinnerCategorySelect } from '@/components/dinner-category-select';
import { DinnerImage } from '@/components/dinner-image';
import { Icon } from '@/components/icon';
import { SheetScreen } from '@/components/sheet';
import { NoteField, StepperRow, SuggestionSettings, settingStyles, usePlanningPreferences } from '@/components/suggestion-settings';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useHouseholdIngredientExclusions } from '@/lib/api/ingredient-exclusions';
import { dinnerCategory, matchesDinnerCategory, searchDinners, type DinnerCategoryFilter } from '@/lib/dinner-categories';
import { suggestDinners } from '@/lib/dinner-suggester';
import { formatDate, formatDay } from '@/lib/format';
import { hapticSelection } from '@/lib/haptics';
import { useT, type TFunction } from '@/lib/i18n';
import { indexByName } from '@/lib/search';
import {
  createDinner,
  createPlanEntry,
  ensurePlanForWeek,
  getDinner,
  useDinnerOptions,
  type LocalDinner,
} from '@/lib/store';
import { useHouseholdDefaultServings } from '@/lib/store/household';
import { addDays, fromDateKey, isoWeekNumber, startOfWeek, toDateKey } from '@/lib/week';

// Snappy enough that the list still feels instant, long enough to read as motion.
// Only the action row and the "recent" strip animate; list rows do not.
// Exit + layout animations on every row meant a keystroke that narrows a long
// list kept ~all the dropped rows alive to fade them, while the keyboard was up.
const SWAP = 140;
const FADE_IN = FadeIn.duration(SWAP);
const FADE_OUT = FadeOut.duration(SWAP);
/** How many recently planned dinners get a one-tap chip above the list. */
const RECENT_COUNT = 6;
const DAY_MS = 86_400_000;
const THUMB = 40;
/** Room for a day's own wish; the week's standing wishes share the request with it. */
const WISH_MAX = 200;

/** "Laget for 2 uker siden" / "Planlagt 15. sep." / "Ikke planlagt ennå". */
function recencyLabel(t: TFunction, lastPlanned: string | null, todayMs: number): string {
  if (!lastPlanned) return t('dinnerPicker.neverPlanned');
  const days = Math.round((todayMs - fromDateKey(lastPlanned).getTime()) / DAY_MS);
  if (days < 0) return t('dinnerPicker.plannedOn', { date: formatDay(lastPlanned) });
  if (days === 0) return t('dinnerPicker.madeToday');
  if (days === 1) return t('dinnerPicker.madeYesterday');
  if (days < 14) return t('dinnerPicker.madeDaysAgo', { count: days });
  if (days < 60) return t('dinnerPicker.madeWeeksAgo', { count: Math.round(days / 7) });
  return t('dinnerPicker.madeOn', { date: formatDay(lastPlanned) });
}

/**
 * The Dinners tab's search, for the day given as `date` (`YYYY-MM-DD`): one
 * field that filters the household's dinners as you go (ranked, see
 * `@/lib/search`) with the category filter icon beside it. A typed name that
 * doesn't exist yet gets a "Create" row, and the return key adds the dinner
 * with that name or creates it. Picking a row or the action schedules the dinner into that week's plan (created lazily) and
 * closes. "Suggest a dinner" swaps the search for a short form — servings, a
 * wish for this day only, and the choices shared with Plan the week — whose
 * button closes the sheet while the suggestion lands on the day (see
 * `@/lib/dinner-suggester`). Presented as a native form sheet from the Plans
 * board.
 */
export default function DinnerPickerSheet() {
  const t = useT();
  const categoryLabel = useDinnerCategoryLabel();
  const theme = useTheme();
  const { date } = useLocalSearchParams<{ date: string }>();
  const dinners = useDinnerOptions();
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<DinnerCategoryFilter>('all');
  const [suggesting, setSuggesting] = useState(false);
  // One create per typed name — a "done" + tap double-fire would otherwise
  // create two dinners with the same name.
  const created = useRef(false);
  const scheduled = useRef(false);

  // Fold every name once per store change, not once per keystroke.
  const index = useMemo(() => indexByName(dinners, (dinner) => dinner.name), [dinners]);
  const trimmed = query.trim();
  const { results, exact } = useMemo(() => searchDinners(index, trimmed, categoryFilter), [index, trimmed, categoryFilter]);
  // A row above the list only when the list can't do the job itself: the
  // typed name is new, or its dinner is hidden by the category filter.
  const action = !trimmed ? null : !exact ? 'create'
    : results.some((dinner) => dinner.id === exact.id) ? null : 'add';
  // The options are already recency-ordered; the chips are the planned head of it.
  const recent = useMemo(
    () => dinners.filter((d) => d.last_planned && matchesDinnerCategory(d.category, categoryFilter)).slice(0, RECENT_COUNT),
    [dinners, categoryFilter],
  );
  const todayMs = fromDateKey(toDateKey(new Date())).getTime();

  function schedule(dinner: LocalDinner) {
    // Once per sheet: a "done" + tap double-fire would otherwise plan the dinner
    // twice and pop two screens.
    if (!date || scheduled.current) return;
    scheduled.current = true;
    const weekStart = startOfWeek(fromDateKey(date));
    const planId = ensurePlanForWeek(
      toDateKey(weekStart),
      toDateKey(addDays(weekStart, 6)),
      t('plans.weekOf', { week: isoWeekNumber(weekStart) }),
    );
    createPlanEntry(planId, {
      dinner_id: dinner.id,
      scheduled_date: date,
      servings: dinner.default_servings,
      meal_type: 'dinner',
    });
    router.back();
  }

  // The board shows the dinner arriving.
  function suggest(servings: number, wish: string) {
    if (!date || scheduled.current) return;
    scheduled.current = true;
    hapticSelection();
    void suggestDinners({ kind: 'day', date, servings, wish });
    router.back();
  }

  function openSuggest() {
    Keyboard.dismiss();
    setSuggesting(true);
  }

  function onCreate() {
    if (!trimmed || exact || created.current) return;
    created.current = true;
    const id = createDinner({ name: trimmed, category: dinnerCategory(categoryFilter) });
    // Read the row back synchronously — the reactive list above hasn't
    // re-rendered yet, and the store seeded the household's default servings.
    const dinner = getDinner(id);
    if (dinner) schedule(dinner);
  }

  // Return key and the action card do the same thing: an existing dinner by
  // that name wins; otherwise create it.
  function onSubmit() {
    if (exact) schedule(exact);
    else onCreate();
  }

  const actionCategory = action === 'create' ? dinnerCategory(categoryFilter) : dinnerCategory(exact?.category);

  if (suggesting && date) {
    return (
      <SheetScreen layout="fill">
        <DaySuggestion date={date} onBack={() => setSuggesting(false)} onStart={suggest} />
      </SheetScreen>
    );
  }

  return (
    <SheetScreen layout="fill">
      {date ? (
        <View style={styles.header}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
            {formatDate(date)}
          </ThemedText>
          <Pressable
            onPress={openSuggest}
            accessibilityRole="button"
            hitSlop={6}
            style={({ pressed }) => [styles.suggest, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
            <Icon name="sparkles" size={13} color={theme.text} />
            <ThemedText type="smallBold">{t('dinnerPicker.suggest')}</ThemedText>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.searchRow}>
        <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}>
          <Icon name="magnifyingglass" size={15} color={theme.textSecondary} />
          <TextInput
            accessibilityLabel={t('dinners.searchOrCreate')}
            placeholder={t('dinners.searchPlaceholder')}
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={(text) => {
              created.current = false;
              setQuery(text);
            }}
            maxLength={255}
            autoFocus
            autoCapitalize="sentences"
            autoCorrect={false}
            returnKeyType="done"
            submitBehavior="submit"
            onSubmitEditing={onSubmit}
            style={[styles.searchInput, { color: theme.text }]}
          />
          {query ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('dinners.clearSearch')}
              hitSlop={10}
              onPress={() => setQuery('')}>
              <Icon name="xmark.circle.fill" size={17} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        <DinnerCategorySelect filter variant="icon" value={categoryFilter} onChange={setCategoryFilter} />
      </View>

      {categoryFilter !== 'all' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${categoryLabel(categoryFilter)}. ${t('dinnerCategories.clearFilter')}`}
          onPress={() => setCategoryFilter('all')}
          style={({ pressed }) => [styles.filterChip, { backgroundColor: theme.backgroundSelected }, pressed && styles.pressed]}>
          <ThemedText type="smallBold">{categoryLabel(categoryFilter)}</ThemedText>
          <Icon name="xmark" size={10} weight="bold" color={theme.textSecondary} />
        </Pressable>
      ) : null}

      {action ? (
        <Animated.View key={action} entering={FADE_IN}>
          <Pressable
            accessibilityRole="button"
            accessibilityHint={t(action === 'create' ? 'dinnerPicker.createHint' : 'dinnerPicker.addExistingHint')}
            onPress={onSubmit}
            style={({ pressed }) => [styles.action, { backgroundColor: theme.backgroundElement },
              pressed && { backgroundColor: theme.backgroundSelected }]}>
            <View style={[styles.actionGlyph,
              { backgroundColor: action === 'create' ? theme.accent : theme.backgroundSelected }]}>
              <Icon
                name={action === 'create' ? 'plus' : 'checkmark'}
                size={14}
                weight="bold"
                color={action === 'create' ? theme.onAccent : theme.text}
              />
            </View>
            <ThemedText style={styles.flex} numberOfLines={1}>
              {t(action === 'create' ? 'dinnerPicker.create' : 'dinnerPicker.addExisting', { name: trimmed })}
            </ThemedText>
            {actionCategory ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.actionCategory}>
                {categoryLabel(actionCategory)}
              </ThemedText>
            ) : null}
          </Pressable>
        </Animated.View>
      ) : null}

      {!trimmed && recent.length > 0 ? (
        <Animated.View entering={FADE_IN} exiting={FADE_OUT} style={styles.recent}>
          <ThemedText type="smallBold">{t('dinnerPicker.recent')}</ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chips}>
            {recent.map((dinner) => (
              <Pressable
                key={dinner.id}
                onPress={() => schedule(dinner)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.chip,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                  pressed && styles.pressed,
                ]}>
                <DinnerImage dinnerId={dinner.id} name={dinner.name} size={22} style={styles.chipImage} />
                <ThemedText type="small" numberOfLines={1} style={styles.chipText}>
                  {dinner.name}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>
      ) : null}

      <FlatList
        data={results}
        keyExtractor={(dinner) => dinner.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // The sheet opens at 60% height: mount roughly one screen of rows and
        // keep the render window tight so a keystroke re-renders a dozen rows,
        // not the household's whole recipe list.
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
        removeClippedSubviews
        // Rows render as one continuous card, like the Dinners tab: each row
        // carries the card surface and draws its own divider.
        renderItem={({ item: dinner, index: i }) => {
          const category = dinnerCategory(dinner.category);
          const recency = recencyLabel(t, dinner.last_planned, todayMs);
          return (
            <Pressable
              onPress={() => schedule(dinner)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: theme.backgroundElement },
                i === 0 && styles.rowFirst,
                i === results.length - 1 && styles.rowLast,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              <DinnerImage dinnerId={dinner.id} name={dinner.name} size={THUMB} />
              <View style={styles.flex}>
                <ThemedText numberOfLines={1}>{dinner.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {category ? `${categoryLabel(category)} · ${recency}` : recency}
                </ThemedText>
              </View>
            </Pressable>
          );
        }}
        // Searching needs no message of its own: the action row already says
        // what the return key will do, and the filter chip clears the category.
        ListEmptyComponent={
          trimmed ? null : (
            <Animated.View entering={FADE_IN} style={styles.empty}>
              <ThemedText type="small" themeColor="textSecondary">
                {categoryFilter !== 'all' ? t('dinnerCategories.noMatches') : t('dinnerPicker.empty')}
              </ThemedText>
            </Animated.View>
          )
        }
      />
    </SheetScreen>
  );
}

/**
 * One more dinner for `date`, shaped before asking: servings for this day, a
 * wish that goes with this request only, and the household's standing choices
 * (see `SuggestionSettings`), which Plan the week uses too. Everything starts
 * filled in, so the button alone is enough.
 */
function DaySuggestion({ date, onBack, onStart }: {
  date: string;
  onBack: () => void;
  onStart: (servings: number, wish: string) => void;
}) {
  const t = useT();
  const theme = useTheme();
  const { ai } = usePlanningPreferences();
  const { ready: exclusionsLoaded } = useHouseholdIngredientExclusions();
  const defaultServings = useHouseholdDefaultServings();
  // Follows the household default until changed here.
  const [servings, setServings] = useState<number | null>(null);
  const [wish, setWish] = useState('');
  const [editingExclusions, setEditingExclusions] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (row: string) => setExpanded(expanded === row ? null : row);
  // The household's own list works offline from the saved copy of the exclusions.
  const canStart = !editingExclusions && (!ai || exclusionsLoaded);

  function start() {
    if (!canStart) return;
    Keyboard.dismiss();
    // Free text only steers new recipes; the household's own are picked for variety.
    onStart(servings ?? defaultServings, ai ? wish : '');
  }

  return (
    <Animated.View entering={FADE_IN} style={styles.panel}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={6}
          style={({ pressed }) => [styles.back, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
          <Icon name="chevron.left" size={14} weight="bold" color={theme.text} />
        </Pressable>
        <View style={styles.flex}>
          <ThemedText type="smallBold">{t('dinnerPicker.suggest')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{formatDate(date)}</ThemedText>
        </View>
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.suggestContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {ai ? (
          <View style={styles.wish}>
            <ThemedText type="smallBold" style={settingStyles.label}>{t('dinnerPicker.wishLabel')}</ThemedText>
            <NoteField
              accessibilityLabel={t('dinnerPicker.wishLabel')}
              placeholder={t('dinnerPicker.wishPlaceholder')}
              value={wish}
              onChangeText={setWish}
              maxLength={WISH_MAX}
              style={{ backgroundColor: theme.backgroundElement }}
            />
          </View>
        ) : null}
        <SuggestionSettings
          expanded={expanded}
          onToggle={toggle}
          onEditingExclusionsChange={setEditingExclusions}
          note={
            <ThemedText type="small" themeColor="textSecondary" style={settingStyles.label}>
              {t('dinnerPicker.sharedSettings')}
            </ThemedText>
          }>
          <StepperRow label={t('weekPlanning.servings')} value={servings ?? defaultServings} onChange={setServings} />
        </SuggestionSettings>
      </ScrollView>

      <View style={styles.footer}>
        <Button disabled={!canStart} onPress={start} title={t('weekPlanning.generateOne')} />
        {ai ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            {t('weekPlanning.privacy')}
          </ThemedText>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    gap: Spacing.three,
  },
  back: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestContent: {
    gap: Spacing.four,
    paddingBottom: Spacing.three,
  },
  wish: {
    gap: Spacing.two,
  },
  footer: {
    gap: Spacing.two,
  },
  center: {
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  suggest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    minHeight: 32,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 44,
    borderRadius: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    padding: 0,
    fontSize: 16,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.two,
    minHeight: 32,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 56,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  actionGlyph: {
    width: THUMB,
    height: THUMB,
    borderRadius: Math.round(THUMB * 0.24),
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCategory: {
    flexShrink: 0,
    maxWidth: '40%',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 56,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  rowFirst: {
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
  },
  rowLast: {
    borderBottomLeftRadius: Spacing.three,
    borderBottomRightRadius: Spacing.three,
  },
  recent: {
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  chip: {
    maxWidth: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    paddingVertical: Spacing.one + Spacing.half,
    paddingLeft: Spacing.one + Spacing.half,
    paddingRight: Spacing.three,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    flexShrink: 1,
  },
  chipImage: {
    borderRadius: 11,
  },
  empty: {
    paddingVertical: Spacing.three,
  },
  flex: {
    flexShrink: 1,
    flexGrow: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
