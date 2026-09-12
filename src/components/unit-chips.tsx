import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { UNIT_SUGGESTIONS } from '@/lib/parse-line';

type UnitChipsProps = {
  /** The unit currently in the amount field, highlighted. */
  value: string | null;
  onPick: (unit: string) => void;
};

/**
 * One-tap common units for an amount field ("500 g", "2 dl"). Free text still
 * works in the field itself; the chips just keep the common spellings
 * consistent so generated lists don't split "g" and "gram" into two lines.
 */
export function UnitChips({ value, onPick }: UnitChipsProps) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      contentContainerStyle={styles.row}>
      {UNIT_SUGGESTIONS.map((unit) => {
        const selected = unit === value;
        return (
          <Pressable
            key={unit}
            onPress={() => onPick(unit)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected ? theme.tint : theme.backgroundElement,
                borderColor: selected ? theme.tint : theme.border,
              },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="small" style={selected ? { color: theme.onTint } : undefined}>
              {unit}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  chip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.6,
  },
});
