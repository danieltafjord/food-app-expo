import { useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type FabProps = {
  onPress: () => void;
  /** Glyph shown in the button. Defaults to a plus. */
  icon?: string;
  accessibilityLabel?: string;
};

/** A circular floating action button pinned to the bottom-right, clearing the tab bar. */
export function Fab({ onPress, icon = '＋', accessibilityLabel }: FabProps) {
  const theme = useTheme();
  // The FAB creates things (a new list) and then navigates; a double tap lands
  // before the push does and would create two. Ignore presses in quick succession.
  const lastPress = useRef(0);
  function press() {
    const now = Date.now();
    if (now - lastPress.current < 600) return;
    lastPress.current = now;
    onPress();
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={press}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: theme.tint },
        pressed && styles.pressed,
      ]}>
      <ThemedText themeColor="onTint" style={styles.icon}>
        {icon}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: Spacing.four,
    bottom: BottomTabInset + Spacing.three,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  icon: {
    fontSize: 30,
    lineHeight: 34,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
});
