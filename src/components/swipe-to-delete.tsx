/*
 * Reanimated shared values are stable mutable refs, read and written with
 * `.get()` / `.set()` (in the gesture worklets and the action handlers):
 * assigning `.value` is what the React Compiler's immutability rule rejects.
 */
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
 * scrolling normally. The actions grow into the space the row slides out of
 * rather than sitting behind it, so the row may be transparent (rows on a
 * native glass sheet have no background to cover them with).
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

  // Built once per row: a rebuilt gesture on every render means a new handler
  // pushed to the native side for every row whenever the list re-renders. The
  // only captures are shared values, read and written with `.get()` / `.set()`
  // so the React Compiler can optimize this component (it rejects `.value =`).
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-12, 12])
        .onStart(() => {
          startX.set(translateX.get());
        })
        .onUpdate((event) => {
          translateX.set(Math.min(
            0,
            Math.max(startX.get() + event.translationX, -revealWidth),
          ));
        })
        .onEnd(() => {
          const reveal = translateX.get() < -revealWidth / 2;
          translateX.set(withTiming(reveal ? -revealWidth : 0, { duration: 160 }));
          scheduleOnRN(setOpen, reveal);
        }),
    [startX, translateX, revealWidth],
  );

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));

  // Only as wide as the gap the row has left: nothing sits behind a resting
  // or dimmed row, and a transparent row never shows red through it.
  const actionsStyle = useAnimatedStyle(() => ({
    width: Math.max(0, -translateX.get()),
  }));

  function close() {
    translateX.set(withTiming(0, { duration: 120 }));
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
      <Animated.View style={[styles.actions, actionsStyle]}>
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
    justifyContent: 'flex-end',
    overflow: 'hidden',
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
