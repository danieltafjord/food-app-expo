import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hapticSelection } from '@/lib/haptics';

type StepperProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Secondary label shown next to the value (e.g. "servings"). */
  unit?: string;
  accessibilityLabel?: string;
  compact?: boolean;
};

/** A themed −/＋ number stepper, clamped to [min, max]. Used by Settings. */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  step = 1,
  unit,
  accessibilityLabel,
  compact = false,
}: StepperProps) {
  const clampTo = (next: number) => onChange(Math.max(min, Math.min(max, next)));

  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.group, compact && styles.compact]}
      // One adjustable element for VoiceOver: swipe up/down steps the value.
      // Without `accessible` the role and label were ignored, and without the
      // actions an adjustable element cannot be changed at all.
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value, text: unit ? `${value} ${unit}` : String(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') clampTo(value + step);
        if (event.nativeEvent.actionName === 'decrement') clampTo(value - step);
      }}>
      <StepButton icon="minus" compact={compact} disabled={value <= min} onPress={() => clampTo(value - step)} />
      <View style={[styles.valueWrap, compact && styles.compactValueWrap]}>
        <ThemedText style={[styles.value, compact && styles.compactValue]}>{value}</ThemedText>
        {unit ? (
          <ThemedText type="small" themeColor="textSecondary">
            {unit}
          </ThemedText>
        ) : null}
      </View>
      <StepButton icon="plus" compact={compact} disabled={value >= max} onPress={() => clampTo(value + step)} />
    </ThemedView>
  );
}

function StepButton({
  icon,
  onPress,
  disabled,
  compact,
}: {
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      // The compact button is 40pt; extend the touch target to 44pt+.
      hitSlop={compact ? 4 : undefined}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compactButton,
        { backgroundColor: theme.backgroundSelected },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}>
      <Icon name={icon} size={compact ? 15 : 18} weight="bold" color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    borderRadius: Spacing.three,
    padding: Spacing.two,
  },
  // Sits inside a card row: no own padding, round buttons, and a fixed-width
  // value so going 9 → 10 doesn't nudge the buttons.
  compact: {
    gap: Spacing.one,
    padding: 0,
  },
  compactButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  compactValueWrap: {
    minWidth: 36,
    justifyContent: 'center',
  },
  compactValue: {
    fontSize: 18,
    lineHeight: 24,
    fontVariant: ['tabular-nums'],
  },
  button: {
    width: 48,
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.6,
  },
  valueWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.one,
  },
  value: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: 700,
  },
});
