/* Shared values coordinate the pager and its three pages (via `.get()` / `.set()`). */
import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type Ref,
} from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { WeekBoard } from '@/components/week-board';
import { Spacing } from '@/constants/theme';
import { useLocale, usePlanEntries, usePlanForWeek, type PlanEntryWithDinner } from '@/lib/store';
import { useHiddenIds } from '@/lib/undo';
import { addWeeks, buildWeek, dateKeyOf, fromDateKey, toDateKey } from '@/lib/week';

type BoardProps = Pick<ComponentProps<typeof WeekBoard>,
  'onMove' | 'onAdd' | 'onEdit' | 'bottomContentInset'>;

export type WeekPagerHandle = { changeWeek: (direction: -1 | 1) => void };

type WeekPagerProps = BoardProps & {
  ref?: Ref<WeekPagerHandle>;
  weekKey: string;
  onChangeWeek: (direction: -1 | 1) => void;
};

// UTC keeps consecutive Monday keys exactly one page apart across DST changes.
function weekIndex(key: string): number {
  return Math.floor(Date.parse(`${key}T00:00:00Z`) / (7 * 24 * 60 * 60 * 1000));
}

/** Keep neighboring weeks mounted so they slide into view during the gesture. */
export function WeekPager({ ref, weekKey, onChangeWeek, ...boardProps }: WeekPagerProps) {
  const currentWeek = useRef(weekKey);
  const origin = useSharedValue(weekIndex(weekKey));
  const width = useSharedValue(0);
  const offset = useSharedValue(0);
  const settling = useSharedValue(false);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const commitWeek = useCallback((fromWeek: string, direction: -1 | 1) => {
    // A jump from the week picker can supersede an animation already in flight.
    if (currentWeek.current === fromWeek) onChangeWeek(direction);
  }, [onChangeWeek]);

  const settle = useCallback((direction: -1 | 0 | 1) => {
    'worklet';
    if (settling.get() || width.get() <= 0) return;
    settling.set(true);
    offset.set(withTiming(-direction * width.get(), {
      duration: direction === 0 ? 180 : 260,
      easing: Easing.out(Easing.cubic),
    }, (finished) => {
      if (!finished) return;
      if (direction === 0) {
        settling.set(false);
      } else {
        scheduleOnRN(commitWeek, weekKey, direction);
      }
    }));
  }, [commitWeek, offset, settling, weekKey, width]);

  useImperativeHandle(ref, () => ({
    changeWeek: (direction) => scheduleOnUI(settle, direction),
  }), [settle]);

  useLayoutEffect(() => {
    currentWeek.current = weekKey;
    scheduleOnUI((index: number) => {
      'worklet';
      cancelAnimation(offset);
      // Pages use absolute week indices, so the arriving page stays in exactly
      // the same position while React replaces the farthest neighboring week.
      origin.set(index);
      offset.set(0);
      settling.set(false);
    }, weekIndex(weekKey));
    return () => {
      scheduleOnUI(() => {
        'worklet';
        cancelAnimation(offset);
      });
    };
  }, [offset, origin, settling, weekKey]);

  const swipe = useMemo(() => Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX([-20, 20])
    .failOffsetY([-12, 12])
    .onTouchesDown((_event, manager) => {
      if (settling.get() || width.get() <= 0) manager.fail();
    })
    .onBegin((event) => {
      startX.set(event.absoluteX);
      startY.set(event.absoluteY);
    })
    .onUpdate((event) => {
      if (settling.get()) return;
      offset.set(Math.max(-width.get(), Math.min(width.get(), event.absoluteX - startX.get())));
    })
    // These callbacks only run after render; settle's RN callback reads currentWeek.
    // eslint-disable-next-line react-hooks/refs
    .onEnd((event, success) => {
      if (!success) return;
      const dx = event.absoluteX - startX.get();
      const dy = event.absoluteY - startY.get();
      const distance = Math.abs(dx);
      const flick = distance >= 24 && Math.abs(event.velocityX) >= 600 && dx * event.velocityX > 0;
      const advance = distance > Math.abs(dy) * 1.5
        && (distance >= Math.min(90, width.get() * 0.2) || flick);
      settle(advance ? (dx < 0 ? 1 : -1) : 0);
    })
    // eslint-disable-next-line react-hooks/refs
    .onFinalize((_event, success) => {
      if (!success && offset.get() !== 0) settle(0);
    }), [offset, settle, settling, startX, startY, width]);

  function onLayout(event: LayoutChangeEvent) {
    width.set(event.nativeEvent.layout.width);
  }

  const weeks = [-1, 0, 1].map((direction) => toDateKey(addWeeks(fromDateKey(weekKey), direction)));

  return (
    <GestureDetector gesture={swipe} touchAction="pan-y">
      <Animated.View style={styles.viewport} onLayout={onLayout} collapsable={false}>
        {weeks.map((key) => (
          <WeekPage
            key={key}
            weekKey={key}
            active={key === weekKey}
            swipe={swipe}
            origin={origin}
            width={width}
            offset={offset}
            settling={settling}
            {...boardProps}
          />
        ))}
      </Animated.View>
    </GestureDetector>
  );
}

function WeekPage({
  weekKey, active, swipe, origin, width, offset, settling, ...boardProps
}: BoardProps & {
  weekKey: string;
  active: boolean;
  swipe: PanGesture;
  origin: SharedValue<number>;
  width: SharedValue<number>;
  offset: SharedValue<number>;
  settling: SharedValue<boolean>;
}) {
  const locale = useLocale();
  const plan = usePlanForWeek(weekKey);
  const entries = usePlanEntries(plan?.id);
  const hidden = useHiddenIds();
  const index = weekIndex(weekKey);
  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (index - origin.get()) * width.get() + offset.get() }],
    pointerEvents: active && !settling.get() ? 'auto' : 'none',
  }));
  const entriesByDate: Record<string, PlanEntryWithDinner[]> = {};
  for (const entry of entries) {
    if (hidden[entry.dinner_id]) continue;
    // Not `??=`: the React Compiler can't lower it and would skip this component.
    const date = dateKeyOf(entry.scheduled_date);
    const bucket = entriesByDate[date];
    if (bucket) bucket.push(entry);
    else entriesByDate[date] = [entry];
  }

  return (
    <Animated.View
      style={[styles.page, pageStyle]}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}>
      <WeekBoard
        days={buildWeek(fromDateKey(weekKey), locale)}
        entriesByDate={entriesByDate}
        weekSwipeGesture={swipe}
        {...boardProps}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  page: { ...StyleSheet.absoluteFill, paddingHorizontal: Spacing.four },
});
