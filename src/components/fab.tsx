import { useRef } from 'react';
import { StyleSheet } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type FabProps = {
  onPress: () => void;
  /** Symbol shown in the button. Defaults to a plus. */
  icon?: IconName;
  accessibilityLabel?: string;
};

/** A circular floating action button pinned to the bottom-right, clearing the tab bar. */
export function Fab({ onPress, icon = 'plus', accessibilityLabel }: FabProps) {
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
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={press}
      scaleTo={0.92}
      style={[styles.fab, { backgroundColor: theme.tint }]}>
      <Icon name={icon} size={22} weight="bold" color={theme.onTint} />
    </PressableScale>
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
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
