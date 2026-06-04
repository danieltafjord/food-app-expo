import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CATEGORY_EMOJI, CATEGORY_ORDER, type CategoryId } from '@/lib/categorize';
import { useT } from '@/lib/i18n';

/** A wrapped grid of selectable aisle chips, used to recategorize an item. */
export function CategoryPicker({
  value,
  onChange,
}: {
  value: CategoryId;
  onChange: (category: CategoryId) => void;
}) {
  const t = useT();
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      {CATEGORY_ORDER.map((id) => {
        const selected = id === value;
        return (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(id)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected ? theme.tint : theme.backgroundElement,
                borderColor: selected ? theme.tint : theme.border,
              },
              pressed && styles.pressed,
            ]}>
            <ThemedText style={styles.emoji}>{CATEGORY_EMOJI[id]}</ThemedText>
            <ThemedText
              type="small"
              style={selected ? { color: theme.onTint } : undefined}
              numberOfLines={1}>
              {t(`categories.${id}`)}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emoji: {
    fontSize: 15,
  },
  pressed: {
    opacity: 0.6,
  },
});
