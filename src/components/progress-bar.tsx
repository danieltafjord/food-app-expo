import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

/** A thin track that eases to `progress` (0–1) whenever it changes. */
export function ProgressBar({ progress }: { progress: number }) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(1, progress));
  const value = useSharedValue(clamped);

  useEffect(() => {
    value.set(withTiming(clamped, { duration: 320 }));
  }, [clamped, value]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${value.get() * 100}%` }));

  return (
    <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
      <Animated.View style={[styles.fill, { backgroundColor: theme.tint }, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
});
