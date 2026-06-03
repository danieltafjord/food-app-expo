/*
 * Drag coordination uses Reanimated shared values created in WeekBoard and passed down
 * so sections and dinner cards share one drag state. They are stable mutable refs, so
 * mutating `.value` across components is intended — but the React Compiler's immutability
 * rule reads them as "props" and flags the writes. Disable it for this file; the compiler
 * correctly skips optimizing these components.
 *
 * Worklets only ever capture serializable values (primitives, shared values, and the single
 * ScrollView animated ref). Day positions come from `onLayout` into a shared number array
 * (NOT an array of animated refs — those can't be sent to the UI runtime), and only ids /
 * date strings cross back via runOnJS.
 */
/* eslint-disable react-hooks/immutability */
import { SymbolView } from 'expo-symbols';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  measure,
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedStyle,
  useFrameCallback,
  useScrollViewOffset,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { DinnerThumbnail } from '@/components/dinner-thumbnail';
import { ThemedText } from '@/components/themed-text';
import { useSyncRefresh } from '@/hooks/use-sync-refresh';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import type { PlanEntryWithDinner } from '@/lib/store';
import type { WeekDay } from '@/lib/week';

/** Distance from a viewport edge (px) within which a held card auto-scrolls. */
const EDGE = 80;
/** Max auto-scroll speed (px per frame ≈ 60fps) reached at the very edge. */
const MAX_SCROLL_SPEED = 14;

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
  const contentY = absoluteY - viewport.pageY + scrollOffset.value;
  const ls = layouts.value;
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
};

/**
 * A Monday→Sunday list of day sections. An empty day shows a full-width Add
 * button; once a dinner is scheduled it replaces the button with the dinner's
 * card, and a small "Add" appears in the day header for additional dinners.
 * Long-press a dinner card to lift and drag it onto another day (the list
 * auto-scrolls when you drag near an edge); a quick tap opens the editor.
 */
export function WeekBoard({ days, entriesByDate, onMove, onAdd, onEdit }: WeekBoardProps) {
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

  const dayDates = days.map((d) => d.date);

  // While a card is held near a viewport edge, scroll continuously (a move event
  // only fires when the finger moves, so a held finger needs this frame loop).
  // Also keep the hovered-day highlight current as new days scroll into view.
  useFrameCallback(() => {
    'worklet';
    if (!dragging.value) {
      return;
    }
    const viewport = measure(scrollRef);
    if (viewport === null) {
      return;
    }
    const top = viewport.pageY;
    const bottom = viewport.pageY + viewport.height;
    let delta = 0;
    if (pointerY.value < top + EDGE) {
      delta = -MAX_SCROLL_SPEED * Math.min(1, (top + EDGE - pointerY.value) / EDGE);
    } else if (pointerY.value > bottom - EDGE) {
      delta = MAX_SCROLL_SPEED * Math.min(1, (pointerY.value - (bottom - EDGE)) / EDGE);
    }
    if (delta !== 0) {
      scrollTo(scrollRef, 0, scrollOffset.value + delta, false);
    }
    hoverIndex.value = dayIndexAt(pointerY.value, scrollRef, scrollOffset, layouts, -1);
  });

  return (
    <Animated.ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {days.map((day, index) => (
        <DaySection
          key={day.date}
          day={day}
          index={index}
          dayDates={dayDates}
          entries={entriesByDate[day.date] ?? []}
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
    zIndex: activeSourceIndex.value === index ? 100 : 1,
  }));

  // Highlight a day while a card from another day hovers over it.
  const dropStyle = useAnimatedStyle(() => ({
    borderColor:
      activeSourceIndex.value !== -1 &&
      hoverIndex.value === index &&
      activeSourceIndex.value !== index
        ? theme.tint
        : 'transparent',
  }));

  return (
    <Animated.View onLayout={onLayout} style={[styles.section, sectionStyle]}>
      <View style={styles.sectionHeader}>
        <View style={styles.dayLabel}>
          <ThemedText type="smallBold">{day.weekday}</ThemedText>
          <ThemedText
            type="small"
            themeColor={day.isToday ? undefined : 'textSecondary'}
            style={day.isToday ? { color: theme.tint, fontWeight: 700 } : undefined}>
            {day.dayOfMonth}
          </ThemedText>
        </View>
        {hasEntries ? (
          <Pressable
            onPress={() => onAdd(day.date)}
            hitSlop={8}
            style={({ pressed }) => [styles.addAnother, pressed && styles.pressed]}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('weekBoard.add')}
            </ThemedText>
          </Pressable>
        ) : null}
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
        ) : (
          <Pressable
            onPress={() => onAdd(day.date)}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('weekBoard.addDinner')}
            </ThemedText>
          </Pressable>
        )}
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

function DraggableDinnerCard({
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
  const theme = useTheme();
  const scheme = useResolvedScheme();
  // A clean elevated surface: white in light mode (less "gray"), the elevated
  // grey in dark mode; border + soft shadow give it depth.
  const cardBg = scheme === 'dark' ? theme.backgroundElement : theme.background;
  const entryId = entry.id; // worklets capture this primitive, never the entry object
  // Drag is vertical-only (day to day), so the card never slides past the
  // list's side edges and get clipped.
  const panY = useSharedValue(0);
  const lift = useSharedValue(0);

  function reset() {
    'worklet';
    panY.value = withTiming(0, { duration: 160 });
    lift.value = withTiming(0, { duration: 160 });
    dragging.value = false;
    activeId.value = null;
    activeSourceIndex.value = -1;
    hoverIndex.value = -1;
  }

  const pan = Gesture.Pan()
    .activateAfterLongPress(200)
    .onStart((event) => {
      activeId.value = entryId;
      activeSourceIndex.value = sourceIndex;
      startScrollOffset.value = scrollOffset.value;
      pointerY.value = event.absoluteY;
      dragging.value = true;
      lift.value = withTiming(1, { duration: 120 });
    })
    .onUpdate((event) => {
      panY.value = event.translationY;
      pointerY.value = event.absoluteY;
      hoverIndex.value = dayIndexAt(event.absoluteY, scrollRef, scrollOffset, layouts, sourceIndex);
    })
    .onEnd((event) => {
      const target = dayIndexAt(event.absoluteY, scrollRef, scrollOffset, layouts, sourceIndex);
      if (target !== sourceIndex) {
        runOnJS(onMove)(entryId, dayDates[target]);
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
    const isActive = activeId.value === entryId;
    // While active, add the scroll delta since drag start so the card stays
    // under the finger even as the list auto-scrolls.
    const scrollComp = isActive ? scrollOffset.value - startScrollOffset.value : 0;
    return {
      transform: [
        { translateY: (isActive ? panY.value : 0) + scrollComp },
        { scale: 1 + lift.value * 0.03 },
      ],
      zIndex: isActive ? 1000 : 1,
      shadowOpacity: 0.05 + lift.value * 0.07,
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, { backgroundColor: cardBg }, cardStyle]}>
        <DinnerThumbnail />
        <ThemedText style={styles.cardName} numberOfLines={1}>
          {entry.dinner_name ?? t('common.dinnerFallback')}
        </ThemedText>
        <View style={styles.servings}>
          <SymbolView
            name="person.fill"
            size={12}
            tintColor={theme.textSecondary}
            type="monochrome"
          />
          <ThemedText type="small" themeColor="textSecondary">
            {entry.servings}
          </ThemedText>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
  },
  section: {
    gap: Spacing.one,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.one,
  },
  dayLabel: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  addAnother: {
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.one,
  },
  dropZone: {
    gap: Spacing.two,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: Spacing.three + Spacing.one,
    padding: Spacing.one,
  },
  addButton: {
    borderWidth: 1.5,
    borderColor: 'rgba(128,128,128,0.35)',
    borderStyle: 'dashed',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.18)',
    shadowColor: '#000',
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cardName: {
    flexShrink: 1,
    flexGrow: 1,
    fontWeight: '600',
  },
  servings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.6,
  },
});
