import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Option<T extends string> = {
  value: T;
  label: string;
  /** Optional secondary line under the label. */
  hint?: string;
};

/** A themed single-select list — used for the settings pickers (theme, language). */
export function OptionGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={styles.group}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.row,
              index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
              pressed && styles.pressed,
            ]}>
            <View style={styles.label}>
              <ThemedText>{option.label}</ThemedText>
              {option.hint ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {option.hint}
                </ThemedText>
              ) : null}
            </View>
            {selected ? (
              <ThemedText style={[styles.check, { color: theme.tint }]}>✓</ThemedText>
            ) : null}
          </Pressable>
        );
      })}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    padding: Spacing.three,
    minHeight: 52,
  },
  label: {
    flexShrink: 1,
    gap: Spacing.half,
  },
  check: {
    fontSize: 18,
    fontWeight: 700,
  },
  pressed: {
    opacity: 0.6,
  },
});
