import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import { BadgeColors } from '@/constants/theme';
import { useResolvedScheme } from '@/hooks/use-theme';
import { REMOTE_CHANGE_MS, useRemoteChange } from '@/lib/sync/remote-changes';

const FADE_IN_MS = 180;
const HOLD_MS = 900;

/**
 * A soft brand-coloured wash over a row that someone else just added or
 * changed, fading out over a few seconds. Place it as the first child of the
 * row; it fills the row and never takes touches. Renders nothing otherwise,
 * so idle rows pay only for one subscription.
 */
export function RemoteChangeWash({ id, radius = 0 }: { id: string; radius?: number }) {
  const at = useRemoteChange(id);
  if (at === undefined) return null;
  // Keyed by arrival, so a second change to the same row flashes again.
  return <Wash key={at} at={at} radius={radius} />;
}

function Wash({ at, radius }: { at: number; radius: number }) {
  const color = BadgeColors[useResolvedScheme()].brand.bg;
  const opacity = useSharedValue(0);

  useEffect(() => {
    // A row scrolled into view late gets only what is left of its highlight.
    const remaining = REMOTE_CHANGE_MS - (Date.now() - at);
    if (remaining <= FADE_IN_MS) return;
    const hold = Math.min(HOLD_MS, remaining - FADE_IN_MS);
    opacity.set(withSequence(
      withTiming(1, { duration: FADE_IN_MS }),
      withDelay(hold, withTiming(0, { duration: Math.max(0, remaining - FADE_IN_MS - hold) })),
    ));
  }, [at, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: color, borderRadius: radius }, style]}
    />
  );
}
