import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { useResolvedScheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';
import { undoPendingDelete, usePendingDelete } from '@/lib/undo';

/** Clears a screen's floating add button (56pt, inset like the tab bar clearance) so both stay tappable. */
const BOTTOM = BottomTabInset + Spacing.three + 56 + Spacing.three;

const ENTER = FadeInDown.duration(220);
const EXIT = FadeOutDown.duration(160);

/**
 * "Deleted · Undo" snackbar for the pending delete (see `@/lib/undo`). Always
 * a dark surface, in both themes, so it reads as a transient overlay rather
 * than part of the page.
 */
export function UndoToast() {
  const t = useT();
  const scheme = useResolvedScheme();
  const pending = usePendingDelete();
  const dark = Colors.dark;
  const surface = scheme === 'dark' ? dark.backgroundSelected : dark.backgroundElement;

  return (
    <View pointerEvents="box-none" style={styles.host}>
      {pending ? (
        <Animated.View
          key={pending.key}
          entering={ENTER}
          exiting={EXIT}
          accessibilityLiveRegion="polite"
          style={[styles.toast, { backgroundColor: surface }]}>
          <ThemedText numberOfLines={1} style={[styles.message, { color: dark.text }]}>
            {pending.message}
          </ThemedText>
          <Pressable
            onPress={undoPendingDelete}
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
            <Icon name="arrow.uturn.backward" size={14} weight="bold" color={dark.tint} />
            <ThemedText type="smallBold" style={{ color: dark.tint }}>
              {t('undo.action')}
            </ThemedText>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: BOTTOM,
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
  },
  toast: {
    width: '100%',
    maxWidth: MaxContentWidth,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingLeft: Spacing.three + Spacing.one,
    paddingRight: Spacing.three,
    borderRadius: Spacing.three,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  message: {
    flex: 1,
    fontSize: 15,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
});
