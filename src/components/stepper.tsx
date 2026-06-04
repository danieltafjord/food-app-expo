import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type StepperProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Secondary label shown next to the value (e.g. "servings"). */
  unit?: string;
  accessibilityLabel?: string;
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
}: StepperProps) {
  const clampTo = (next: number) => onChange(Math.max(min, Math.min(max, next)));

  return (
    <ThemedView
      type="backgroundElement"
      style={styles.group}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}>
      <StepButton label="−" disabled={value <= min} onPress={() => clampTo(value - step)} />
      <View style={styles.valueWrap}>
        <ThemedText style={styles.value}>{value}</ThemedText>
        {unit ? (
          <ThemedText type="small" themeColor="textSecondary">
            {unit}
          </ThemedText>
        ) : null}
      </View>
      <StepButton label="＋" disabled={value >= max} onPress={() => clampTo(value + step)} />
    </ThemedView>
  );
}

function StepButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: theme.backgroundSelected },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}>
      <ThemedText style={styles.buttonLabel}>{label}</ThemedText>
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
  button: {
    width: 48,
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: 600,
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
