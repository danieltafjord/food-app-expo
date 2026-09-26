import { useDinnerCategoryLabel } from '@/lib/store/dinner-categories';
/*
 * Drag coordination uses Reanimated shared values created in WeekBoard and passed down
 * so sections and dinner cards share one drag state. They are stable mutable refs, read
 * and written with `.get()` / `.set()`: assigning `.value` on a shared value received as
 * a prop is what the React Compiler rejects, and it would skip optimizing the board and
 * every card (rebuilding each card's gestures on every render).
 *
 * Worklets only ever capture serializable values (primitives, shared values, and the single
 * ScrollView animated ref). Day positions come from `onLayout` into a shared number array
 * (NOT an array of animated refs — those can't be sent to the UI runtime), and only ids /
 * date strings cross back via runOnJS.
 */
import { SymbolView } from 'expo-symbols';
import { memo, useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import Animated, {
  LinearTransition,
  measure,
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useFrameCallback,
  useScrollViewOffset,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { DinnerImage } from '@/components/dinner-image';
import { Icon } from '@/components/icon';
import { RemoteChangeWash } from '@/components/remote-change-wash';
import { ThemedText } from '@/components/themed-text';
import { useSyncRefresh } from '@/hooks/use-sync-refresh';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { BadgeColors, BottomTabInset, Spacing } from '@/constants/theme';
import { useIncomingSuggestions, useSwapInProgress } from '@/lib/dinner-suggester';
import { hapticDrop, hapticLift } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { dinnerCategory } from '@/lib/dinner-categories';
import type { PlanEntryWithDinner } from '@/lib/store';
import type { WeekDay } from '@/lib/week';

/** Distance from a viewport edge (px) within which a held card auto-scrolls. */
const EDGE = 80;
/** Max auto-scroll speed (px per frame ≈ 60fps) reached at the very edge. */
const MAX_SCROLL_SPEED = 14;

/**
 * When a dinner is dropped onto another day, the source day shrinks and the
 * target grows. This animates those size/position changes (and the days sliding
 * below them) so the board settles smoothly instead of snapping. Near-critically
 * damped, so it glides without bouncing. Only runs on the post-drop re-flow —
 * never during the drag, which moves cards via transforms, not layout.
 */
const REFLOW = LinearTransition.springify().damping(24).stiffness(200).mass(0.7);

/** Height of a dinner card; the empty-day row matches it so the date rail lines up. */
const CARD_HEIGHT = 62;

/** Shared empty list so a day with no dinners gets the same prop every render. */
const NO_ENTRIES: PlanEntryWithDinner[] = [];

type ScrollRef = ReturnType<typeof useAnimatedRef<Animated.ScrollView>>;
/** Per-day [top, height] within the scroll content, filled by each section's onLayout. */
type Layouts = SharedValue<([number, number] | undefined)[]>;

/** Day index under `absoluteY`, computed from section layouts + current scroll. */
function dayIndexAt(
  absoluteY: number,
  scrollRef: ScrollRef,
  scrollOffset: SharedValue<number>,
  layouts: Layouts,
  fallback: number,
): number {
  'worklet';
  const viewport = measure(scrollRef);
  if (viewport === null) {
    return fallback;
  }
  const contentY = absoluteY - viewport.pageY + scrollOffset.get();
  const ls = layouts.get();
  for (let i = 0; i < ls.length; i += 1) {
    const l = ls[i];
    if (l !== undefined && contentY >= l[0] && contentY <= l[0] + l[1]) {
      return i;
    }
  }
  return fallback;
}

type WeekBoardProps = {
  days: WeekDay[];
  entriesByDate: Record<string, PlanEntryWithDinner[]>;
  onMove: (entryId: string, toDate: string) => void;
  onAdd: (date: string) => void;
  onEdit: (entryId: string) => void;
  weekSwipeGesture: PanGesture;
  /** A dock below the board already clears the tab bar; avoid reserving that space twice. */
  bottomContentInset?: number;
};

/**
 * A Monday→Sunday list of day rows: the date in a rail on the left, the day's
 * dinners to its right. An empty day shows an Add row; once a dinner is scheduled
 * its card replaces the row; a second dinner for the same day is added from the
 * card's editor sheet.
 * Long-press a dinner card to lift and drag it onto another day (the list
 * auto-scrolls when you drag near an edge); a quick tap opens the editor.
 * Swipe left for the next week or right for the previous week.
 */
// A constant, not an expression in the parameter list: the React Compiler can't
// reorder a computed default and would skip the whole component.
const DEFAULT_BOTTOM_INSET = BottomTabInset + Spacing.three;

export function WeekBoard({
  days, entriesByDate, onMove, onAdd, onEdit, weekSwipeGesture,
  bottomContentInset = DEFAULT_BOTTOM_INSET,
}: WeekBoardProps) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollOffset = useScrollViewOffset(scrollRef);
  const layouts: Layouts = useSharedValue<([number, number] | undefined)[]>([]);
  const { refreshing, onRefresh } = useSyncRefresh();

  const activeId = useSharedValue<string | null>(null);
  const activeSourceIndex = useSharedValue(-1);
  const hoverIndex = useSharedValue(-1);
  const dragging = useSharedValue(false);
  const pointerY = useSharedValue(0);
  const startScrollOffset = useSharedValue(0);

  // The pager gets first choice of horizontal movement; vertical movement
  // releases the scroll view. A card's long-press drag still competes normally.
  const boardGesture = useMemo(
    () => Gesture.Native().requireExternalGestureToFail(weekSwipeGesture),
    [weekSwipeGesture],
  );

  const dayDates = days.map((d) => d.date);

  // While a card is held near a viewport edge, scroll continuously (a move event
  // only fires when the finger moves, so a held finger needs this frame loop).
  // Also keep the hovered-day highlight current as new days scroll into view.
  const frame = useFrameCallback(() => {
    'worklet';
    if (!dragging.get()) {
      return;
    }
    const viewport = measure(scrollRef);
    if (viewport === null) {
      return;
    }
    const top = viewport.pageY;
    const bottom = viewport.pageY + viewport.height;
    let delta = 0;
    if (pointerY.get() < top + EDGE) {
      delta = -MAX_SCROLL_SPEED * Math.min(1, (top + EDGE - pointerY.get()) / EDGE);
    } else if (pointerY.get() > bottom - EDGE) {
      delta = MAX_SCROLL_SPEED * Math.min(1, (pointerY.get() - (bottom - EDGE)) / EDGE);
    }
    if (delta !== 0) {
      scrollTo(scrollRef, 0, scrollOffset.get() + delta, false);
    }
    hoverIndex.set(dayIndexAt(pointerY.get(), scrollRef, scrollOffset, layouts, -1));
  }, false);

  // Only run the per-frame auto-scroll/hover loop while a card is actually being
  // dragged. Starting inactive (and toggling on the drag flag) avoids waking the
  // UI runtime ~60×/sec for the board's whole lifetime just to early-return.
  const setFrameActive = (active: boolean) => frame.setActive(active);
  useAnimatedReaction(
    () => dragging.get(),
    (isDragging, wasDragging) => {
      if (isDragging !== wasDragging) {
        runOnJS(setFrameActive)(isDragging);
      }
    },
  );

  return (
    <GestureDetector gesture={boardGesture} touchAction="pan-y">
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: bottomContentInset }]}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {days.map((day, index) => (
          <DaySection
            key={day.date}
            day={day}
            index={index}
            dayDates={dayDates}
            entries={entriesByDate[day.date] ?? NO_ENTRIES}
            scrollRef={scrollRef}
            scrollOffset={scrollOffset}
            layouts={layouts}
            activeId={activeId}
            activeSourceIndex={activeSourceIndex}
            hoverIndex={hoverIndex}
            dragging={dragging}
            pointerY={pointerY}
            startScrollOffset={startScrollOffset}
            onMove={onMove}
            onAdd={onAdd}
            onEdit={onEdit}
          />
        ))}
      </Animated.ScrollView>
    </GestureDetector>
  );
}

type DaySectionProps = {
  day: WeekDay;
  index: number;
  dayDates: string[];
  entries: PlanEntryWithDinner[];
  scrollRef: ScrollRef;
  scrollOffset: SharedValue<number>;
  layouts: Layouts;
  activeId: SharedValue<string | null>;
  activeSourceIndex: SharedValue<number>;
  hoverIndex: SharedValue<number>;
  dragging: SharedValue<boolean>;
  pointerY: SharedValue<number>;
  startScrollOffset: SharedValue<number>;
  onMove: (entryId: string, toDate: string) => void;
  onAdd: (date: string) => void;
  onEdit: (entryId: string) => void;
};

function DaySection({
  day,
  index,
  dayDates,
  entries,
  scrollRef,
  scrollOffset,
  layouts,
  activeId,
  activeSourceIndex,
  hoverIndex,
  dragging,
  pointerY,
  startScrollOffset,
  onMove,
  onAdd,
  onEdit,
}: DaySectionProps) {
  const t = useT();
  const theme = useTheme();
  const hasEntries = entries.length > 0;
  // Suggested dinners on their way to this day hold their place on the board.
  const incoming = useIncomingSuggestions(day.date);

  // Record this section's position within the scroll content for drag hit-testing.
  function onLayout(event: LayoutChangeEvent) {
    const { y, height } = event.nativeEvent.layout;
    layouts.modify((current) => {
      'worklet';
      current[index] = [y, height];
      return current;
    });
  }

  // Lift the source day above its neighbours so the dragged card floats over them.
  const sectionStyle = useAnimatedStyle(() => ({
    zIndex: activeSourceIndex.get() === index ? 100 : 1,
  }));

  // Highlight a day while a card from another day hovers over it.
  const dropStyle = useAnimatedStyle(() => ({
    borderColor:
      activeSourceIndex.get() !== -1 &&
      hoverIndex.get() === index &&
      activeSourceIndex.get() !== index
        ? theme.tint
        : 'transparent',
  }));

  return (
    <Animated.View onLayout={onLayout} layout={REFLOW} style={[styles.section, sectionStyle]}>
      {/* Date rail: weekday over day-of-month, to the left of the day's dinners. */}
      <View
        style={styles.dayRail}
        accessible
        accessibilityLabel={`${day.weekday} ${day.dayOfMonth}`}>
        <ThemedText
          style={[styles.railWeekday, { color: day.isToday ? theme.accent : theme.textSecondary }]}>
          {day.weekday}
        </ThemedText>
        <ThemedText style={[styles.railDate, day.isToday && { color: theme.accent }]}>
          {day.dayOfMonth}
        </ThemedText>
      </View>

      <Animated.View style={[styles.dropZone, dropStyle]}>
        {hasEntries ? (
          entries.map((entry) => (
            <DraggableDinnerCard
              key={entry.id}
              entry={entry}
              sourceIndex={index}
              dayDates={dayDates}
              scrollRef={scrollRef}
              scrollOffset={scrollOffset}
              layouts={layouts}
              activeId={activeId}
              activeSourceIndex={activeSourceIndex}
              hoverIndex={hoverIndex}
              dragging={dragging}
              pointerY={pointerY}
              startScrollOffset={startScrollOffset}
              onMove={onMove}
              onEdit={onEdit}
            />
          ))
        ) : incoming ? null : (
          // An open slot, not content: a dashed outline that stays quiet next
          // to the planned dinners, and fills in softly under the finger.
          <Pressable
            onPress={() => onAdd(day.date)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.addButton,
              { borderColor: theme.borderStrong },
              pressed && { backgroundColor: theme.backgroundElement },
            ]}>
            <Icon name="plus" size={14} color={theme.textSecondary} />
            <ThemedText themeColor="textSecondary">{t('weekBoard.addDinner')}</ThemedText>
          </Pressable>
        )}
        {Array.from({ length: incoming }, (_, slot) => (
          <View key={`incoming-${slot}`} accessible accessibilityLiveRegion="polite"
            style={[styles.addButton, styles.incoming, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
            <ActivityIndicator size="small" color={theme.textSecondary} />
            <ThemedText themeColor="textSecondary">{t('weekBoard.suggesting')}</ThemedText>
          </View>
        ))}
      </Animated.View>
    </Animated.View>
  );
}

type DraggableDinnerCardProps = {
  entry: PlanEntryWithDinner;
  sourceIndex: number;
  dayDates: string[];
  scrollRef: ScrollRef;
  scrollOffset: SharedValue<number>;
  layouts: Layouts;
  activeId: SharedValue<string | null>;
  activeSourceIndex: SharedValue<number>;
  hoverIndex: SharedValue<number>;
  dragging: SharedValue<boolean>;
  pointerY: SharedValue<number>;
  startScrollOffset: SharedValue<number>;
  onMove: (entryId: string, toDate: string) => void;
  onEdit: (entryId: string) => void;
};

/**
 * Memoised by hand as well as by the compiler: every render of the board — a
 * pull-to-refresh toggle, a plan change on another week — would otherwise
 * rebuild every card's gestures and push new handlers to the native side. Its
 * props are all referentially stable between real changes (shared values,
 * callbacks, and the entry object from the cached plan selector).
 */
const DraggableDinnerCard = memo(function DraggableDinnerCard({
  entry,
  sourceIndex,
  dayDates,
  scrollRef,
  scrollOffset,
  layouts,
  activeId,
  activeSourceIndex,
  hoverIndex,
  dragging,
  pointerY,
  startScrollOffset,
  onMove,
  onEdit,
}: DraggableDinnerCardProps) {
  const t = useT();
  const categoryLabel = useDinnerCategoryLabel();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const warning = BadgeColors[scheme].warning;
  // A clean elevated surface: white in light mode (less "gray"), the elevated
  // grey in dark mode; border + soft shadow give it depth.
  const cardBg = scheme === 'dark' ? theme.backgroundElement : theme.background;
  const count = entry.ingredient_count;
  const category = dinnerCategory(entry.dinner_category);
  const swapping = useSwapInProgress(entry.id);
  const entryId = entry.id; // worklets capture this primitive, never the entry object
  // Drag is vertical-only (day to day), so the card never slides past the
  // list's side edges and get clipped.
  const panY = useSharedValue(0);
  const lift = useSharedValue(0);
  // Set true the moment this card is dropped onto another day. It keeps the card
  // pinned at the drop point (see `cardStyle`) instead of snapping back to its
  // source slot for a few frames until the store update re-renders it into the
  // target day and this instance unmounts.
  const moved = useSharedValue(false);

  function reset() {
    'worklet';
    // A moved card is about to unmount into the target day — leave it where it
    // was dropped. Animating panY/lift back home is the visible "jump home".
    if (!moved.get()) {
      panY.set(withTiming(0, { duration: 160 }));
      lift.set(withTiming(0, { duration: 160 }));
    }
    dragging.set(false);
    activeId.set(null);
    activeSourceIndex.set(-1);
    hoverIndex.set(-1);
  }

  const pan = Gesture.Pan()
    .activateAfterLongPress(200)
    .onStart((event) => {
      activeId.set(entryId);
      activeSourceIndex.set(sourceIndex);
      startScrollOffset.set(scrollOffset.get());
      pointerY.set(event.absoluteY);
      dragging.set(true);
      lift.set(withTiming(1, { duration: 120 }));
      runOnJS(hapticLift)();
    })
    .onUpdate((event) => {
      panY.set(event.translationY);
      pointerY.set(event.absoluteY);
      hoverIndex.set(dayIndexAt(event.absoluteY, scrollRef, scrollOffset, layouts, sourceIndex));
    })
    .onEnd((event) => {
      const target = dayIndexAt(event.absoluteY, scrollRef, scrollOffset, layouts, sourceIndex);
      if (target !== sourceIndex) {
        moved.set(true);
        runOnJS(onMove)(entryId, dayDates[target]);
        runOnJS(hapticDrop)();
      }
      reset();
    })
    .onFinalize(() => {
      reset();
    });

  // A quick tap (no long press) opens the editor instead of dragging.
  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(onEdit)(entryId);
  });

  const gesture = Gesture.Exclusive(pan, tap);

  const cardStyle = useAnimatedStyle(() => {
    // `dragLike` = actively dragged, OR just dropped onto another day and waiting
    // to unmount. Both keep the drag offset applied so the card never snaps back
    // to its source slot — it stays under the finger, then at the drop point until
    // the re-render places it on the target day.
    const dragLike = activeId.get() === entryId || moved.get();
    // While dragging, add the scroll delta since drag start so the card stays
    // under the finger even as the list auto-scrolls.
    const scrollComp = dragLike ? scrollOffset.get() - startScrollOffset.get() : 0;
    return {
      transform: [
        { translateY: (dragLike ? panY.get() : 0) + scrollComp },
        { scale: 1 + lift.get() * 0.03 },
      ],
      zIndex: dragLike ? 1000 : 1,
      shadowOpacity: 0.05 + lift.get() * 0.07,
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View layout={REFLOW} style={[styles.card, { backgroundColor: cardBg }, cardStyle]}>
        {/* Someone else just planned, moved or changed this dinner. */}
        <RemoteChangeWash id={entry.id} radius={Spacing.three} />
        <DinnerImage dinnerId={entry.dinner_id} name={entry.dinner_name} size={40} />
        <View style={styles.cardText}>
          <ThemedText style={styles.cardName} numberOfLines={1}>
            {entry.dinner_name ?? t('common.dinnerFallback')}
          </ThemedText>
          {/* What the dinner brings to the shopping list — a dinner with no
              ingredients is the one thing worth flagging on the board. */}
          {swapping ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} accessibilityLiveRegion="polite">
              {t('weekBoard.swapping')}
            </ThemedText>
          ) : count === 0 ? (
            <View style={styles.warn} accessible accessibilityLabel={`${category ? `${categoryLabel(category)}, ` : ''}${t('weekBoard.noIngredients')}`}>
              <Icon name="exclamationmark.triangle.fill" size={10} color={warning.fg} />
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.warnText}>
                {category ? `${categoryLabel(category)} · ` : ''}
                <ThemedText type="small" style={{ color: warning.fg }}>0 {t('common.ingredients')}</ThemedText>
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {category ? `${categoryLabel(category)} · ` : ''}{count} {count === 1 ? t('common.ingredient') : t('common.ingredients')}
            </ThemedText>
          )}
        </View>
        {swapping ? <ActivityIndicator size="small" color={theme.textSecondary} /> : <View style={styles.servings}>
          <SymbolView
            name={{ ios: 'person.fill', android: 'person', web: 'person' }}
            size={12}
            tintColor={theme.textSecondary}
            type="monochrome"
          />
          <ThemedText type="small" themeColor="textSecondary">
            {entry.servings}
          </ThemedText>
        </View>}
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    gap: Spacing.two,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.one,
  },
  // Fixed width so every day's cards share one left edge; the top padding centres
  // the two-line date on the first card (drop-zone inset + half the height difference).
  dayRail: {
    width: 44,
    alignItems: 'center',
    paddingTop: 17,
  },
  railWeekday: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '600',
  },
  railDate: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dropZone: {
    flex: 1,
    gap: Spacing.two,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: Spacing.three + Spacing.one,
    padding: Spacing.one,
  },
  // Same footprint as the card it becomes, so nothing jumps when it lands.
  incoming: {
    borderStyle: 'solid',
    borderWidth: StyleSheet.hairlineWidth,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: CARD_HEIGHT,
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    paddingHorizontal: Spacing.three,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: CARD_HEIGHT,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.18)',
    shadowColor: '#000',
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cardText: {
    flexShrink: 1,
    flexGrow: 1,
    gap: Spacing.half,
  },
  cardName: {
    fontWeight: '600',
  },
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  warnText: {
    flexShrink: 1,
  },
  servings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
});
