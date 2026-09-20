/*
 * Reanimated shared values are stable mutable refs, so writing `.value` (in the
 * gesture worklets and the action handlers) is intended — but the React
 * Compiler's immutability rule reads them as locals and flags the writes, so it
 * is disabled here (same as week-board.tsx).
 */
/* eslint-disable react-hooks/immutability */
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Width of each revealed action. */
const ACTION_WIDTH = 88;

type SwipeToDeleteProps = {
  children: ReactNode;
  /** Called when the revealed delete action is tapped. */
  onDelete: () => void;
  /** Text shown in the red action (e.g. the localized "Delete"). */
  label: string;
  /** Optional neutral action revealed next to delete (e.g. "Edit"). */
  secondary?: { label: string; onPress: () => void };
};

/**
 * Wraps a row so a horizontal swipe reveals a red delete action — and,
 * optionally, a neutral secondary action beside it — behind the row.
 *
 * Built on the same `Gesture.Pan` + Reanimated primitives the week board uses
 * (rather than `ReanimatedSwipeable`). The pan only activates on a clear
 * horizontal drag and fails on vertical movement, so a parent ScrollView keeps
 * scrolling normally. The child must be opaque and the parent clipped so the row
 * slides cleanly over the actions.
 */
export function SwipeToDelete({ children, onDelete, label, secondary }: SwipeToDeleteProps) {
  const theme = useTheme();
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const revealWidth = ACTION_WIDTH * (secondary ? 2 : 1);
  // Mirrors the settled position on the JS side: while the actions are revealed
  // a tap on the row should close it, not reach the row's own press handler
  // (which would tick a shopping item the user only meant to put back).
  const [open, setOpen] = useState(false);

  // Built once per row: the compiler skips this component, and a rebuilt
  // gesture on every render means a new handler pushed to the native side for
  // every row whenever the list re-renders. The only captures are shared values.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-12, 12])
        .onStart(() => {
          startX.value = translateX.value;
        })
        .onUpdate((event) => {
          translateX.value = Math.min(
            0,
            Math.max(startX.value + event.translationX, -revealWidth),
          );
        })
        .onEnd(() => {
          const reveal = translateX.value < -revealWidth / 2;
          translateX.value = withTiming(reveal ? -revealWidth : 0, { duration: 160 });
          scheduleOnRN(setOpen, reveal);
        }),
    [startX, translateX, revealWidth],
  );

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Hidden until the row actually moves: rows dim with opacity while pressed,
  // and the red action would otherwise show through a resting row.
  const actionsStyle = useAnimatedStyle(() => ({
    opacity: translateX.value < 0 ? 1 : 0,
  }));

  function close() {
    translateX.value = withTiming(0, { duration: 120 });
    setOpen(false);
  }

  function remove() {
    close();
    onDelete();
  }

  function runSecondary() {
    close();
    secondary?.onPress();
  }

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.actions, { width: revealWidth }, actionsStyle]}>
        {secondary ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={secondary.label}
            onPress={runSecondary}
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}>
            <ThemedText style={styles.label}>{secondary.label}</ThemedText>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={remove}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: theme.danger },
            pressed && styles.pressed,
          ]}>
          <ThemedText themeColor="onTint" style={styles.label}>
            {label}
          </ThemedText>
        </Pressable>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>
          {children}
          {open ? (
            <Pressable onPress={close} accessible={false} style={StyleSheet.absoluteFill} />
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  actions: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  action: {
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  label: {
    fontWeight: 700,
  },
  pressed: {
    opacity: 0.8,
  },
});
