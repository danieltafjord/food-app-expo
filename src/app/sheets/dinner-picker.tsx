import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { SheetScreen } from '@/components/sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { BadgeColors, Spacing } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { formatDate, formatDay } from '@/lib/format';
import { useT, type TFunction } from '@/lib/i18n';
import { findExact, indexByName, searchIndex } from '@/lib/search';
import {
  createDinner,
  createPlanEntry,
  ensurePlanForWeek,
  getDinner,
  useDinnerOptions,
  useLocale,
  type LocalDinner,
} from '@/lib/store';
import { addDays, fromDateKey, startOfWeek, toDateKey, weekLabel } from '@/lib/week';

// Snappy enough that the list still feels instant, long enough to read as motion.
// Only the single action card and the "recent" strip animate; list rows do not.
// Exit + layout animations on every row meant a keystroke that narrows a long
// list kept ~all the dropped rows alive to fade them, while the keyboard was up.
const SWAP = 140;
const FADE_IN = FadeIn.duration(SWAP);
const FADE_OUT = FadeOut.duration(SWAP);
/** How many recently planned dinners get a one-tap chip above the list. */
const RECENT_COUNT = 6;
const DAY_MS = 86_400_000;

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
 * One "search or create" field for the day given as `date` (`YYYY-MM-DD`):
 * typing filters the household's dinners as you go (ranked, see `@/lib/search`).
 * A fixed action card under the field always shows what the return key will
 * do with the typed name — create it, or add the dinner that already has that
 * name — so nothing above the list changes height as you type. Picking a row
 * or the card schedules the dinner into that week's plan (created lazily) and
 * closes. Presented as a native form sheet from the Plans board.
 */
export default function DinnerPickerSheet() {
  const t = useT();
  const theme = useTheme();
  const brand = BadgeColors[useResolvedScheme()].brand;
  const locale = useLocale();
  const { date } = useLocalSearchParams<{ date: string }>();
  const dinners = useDinnerOptions();
  const [query, setQuery] = useState('');
  // One create per typed name — a "done" + tap double-fire would otherwise
  // create two dinners with the same name.
  const created = useRef(false);

  // Fold every name once per store change, not once per keystroke.
  const index = useMemo(() => indexByName(dinners, (dinner) => dinner.name), [dinners]);
  const trimmed = query.trim();
  const results = useMemo(() => searchIndex(index, trimmed), [index, trimmed]);
  const exact = useMemo(() => findExact(index, trimmed), [index, trimmed]);
  const action: 'idle' | 'create' | 'add' = !trimmed ? 'idle' : exact ? 'add' : 'create';
  // The options are already recency-ordered; the chips are the planned head of it.
  const recent = useMemo(
    () => dinners.filter((d) => d.last_planned).slice(0, RECENT_COUNT),
    [dinners],
  );
  const todayMs = fromDateKey(toDateKey(new Date())).getTime();

  function schedule(dinner: LocalDinner) {
    if (!date) return;
    const weekStart = startOfWeek(fromDateKey(date));
    const planId = ensurePlanForWeek(
      toDateKey(weekStart),
      toDateKey(addDays(weekStart, 6)),
      t('plans.weekOf', { label: weekLabel(weekStart, locale) }),
    );
    createPlanEntry(planId, {
      dinner_id: dinner.id,
      scheduled_date: date,
      servings: dinner.default_servings,
      meal_type: 'dinner',
    });
    router.back();
  }

  function onCreate() {
    if (action !== 'create' || created.current) return;
    created.current = true;
    const id = createDinner({ name: trimmed });
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

  const actionTitle =
    action === 'create'
      ? t('dinnerPicker.create', { name: trimmed })
      : action === 'add'
        ? t('dinnerPicker.addExisting', { name: trimmed })
        : t('dinnerPicker.idleTitle');
  const actionHint =
    action === 'create'
      ? t('dinnerPicker.createHint')
      : action === 'add'
        ? t('dinnerPicker.addExistingHint')
        : t('dinnerPicker.idleHint');
  const idle = action === 'idle';

  return (
    <SheetScreen layout="fill">
      {date ? (
        <ThemedText type="small" themeColor="textSecondary">
          {formatDate(date)}
        </ThemedText>
      ) : null}

      <TextField
        label={t('dinnerPicker.searchOrCreate')}
        placeholder={t('dinnerPicker.placeholder')}
        value={query}
        onChangeText={(text) => {
          created.current = false;
          setQuery(text);
        }}
        autoFocus
        autoCapitalize="sentences"
        autoCorrect={false}
        returnKeyType="done"
        blurOnSubmit={false}
        onSubmitEditing={onSubmit}
      />

      {/* Fixed-height slot: the card crossfades between states but never
          resizes, so the list below stays put while typing. */}
      <View style={styles.actionSlot}>
        <Animated.View
          key={action}
          entering={FADE_IN}
          exiting={FADE_OUT}
          style={StyleSheet.absoluteFill}>
          <Pressable
            onPress={onSubmit}
            disabled={idle}
            accessibilityRole="button"
            accessibilityLabel={actionTitle}
            style={({ pressed }) => [
              styles.actionCard,
              { backgroundColor: idle ? theme.backgroundElement : brand.bg },
              pressed && styles.actionPressed,
            ]}>
            <View
              style={[
                styles.actionBadge,
                { backgroundColor: idle ? theme.backgroundSelected : theme.tint },
              ]}>
              <ThemedText themeColor={idle ? 'textSecondary' : 'onTint'} style={styles.actionGlyph}>
                {action === 'add' ? '✓' : '＋'}
              </ThemedText>
            </View>
            <View style={styles.flex}>
              <ThemedText
                type="smallBold"
                themeColor={idle ? 'textSecondary' : undefined}
                style={idle ? undefined : { color: brand.fg }}
                numberOfLines={1}>
                {actionTitle}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {actionHint}
              </ThemedText>
            </View>
          </Pressable>
        </Animated.View>
      </View>

      {idle && recent.length > 0 ? (
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
                <ThemedText type="small" numberOfLines={1}>
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
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // The sheet opens at 60% height: mount roughly one screen of rows and
        // keep the render window tight so a keystroke re-renders a dozen rows,
        // not the household's whole recipe list.
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
        removeClippedSubviews
        renderItem={({ item: dinner }) => (
          <Pressable
            onPress={() => schedule(dinner)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: theme.border },
              pressed && styles.pressed,
            ]}>
            <ThemedText style={styles.flex} numberOfLines={1}>
              {dinner.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {recencyLabel(t, dinner.last_planned, todayMs)}
            </ThemedText>
          </Pressable>
        )}
        ListEmptyComponent={
          <Animated.View entering={FADE_IN} style={styles.empty}>
            <ThemedText type="small" themeColor="textSecondary">
              {trimmed ? t('dinnerPicker.noMatches') : t('dinnerPicker.empty')}
            </ThemedText>
          </Animated.View>
        }
      />
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionSlot: {
    // Badge (36) + card padding (2 × 16): the card's natural height, pinned so
    // the crossfading copies overlap and the list never moves.
    height: 36 + Spacing.three * 2,
  },
  actionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  actionBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionGlyph: {
    fontSize: 20,
    lineHeight: 24,
  },
  actionPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  recent: {
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  chip: {
    maxWidth: 180,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
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
