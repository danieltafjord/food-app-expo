import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

import { CategoryPicker } from '@/components/category-picker';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CATEGORY_EMOJI, type CategoryId } from '@/lib/categorize';
import { useT } from '@/lib/i18n';

const SWAP = 160;

/**
 * A select-style category field: shows only the current aisle as a tappable
 * row; tapping unfolds the full chip grid beneath it, and picking a chip (or
 * tapping the row again) folds it back. Keeps the edit sheet short — category
 * chips are only on screen while the user is actually changing the aisle.
 */
export function CategorySelect({
  value,
  onChange,
}: {
  value: CategoryId;
  onChange: (category: CategoryId) => void;
}) {
  const t = useT();
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: withTiming(open ? '180deg' : '0deg', { duration: SWAP }) }],
  }));

  return (
    <Animated.View layout={LinearTransition.duration(SWAP)} style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t(`categories.${value}`)}
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: open ? theme.tint : 'transparent',
          },
          pressed && styles.pressed,
        ]}>
        <ThemedText style={styles.emoji}>{CATEGORY_EMOJI[value]}</ThemedText>
        <ThemedText style={styles.label} numberOfLines={1}>
          {t(`categories.${value}`)}
        </ThemedText>
        <Animated.View style={chevron}>
          <SymbolView
            name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
            size={16}
            tintColor={theme.textSecondary}
            type="monochrome"
            fallback={
              <ThemedText type="small" themeColor="textSecondary">
                ⌄
              </ThemedText>
            }
          />
        </Animated.View>
      </Pressable>

      {open ? (
        <Animated.View
          entering={FadeIn.duration(SWAP)}
          exiting={FadeOut.duration(SWAP)}
          style={styles.grid}>
          <CategoryPicker
            value={value}
            onChange={(next) => {
              onChange(next);
              setOpen(false);
            }}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
  emoji: {
    fontSize: 18,
  },
  label: {
    flex: 1,
  },
  grid: {
    paddingTop: Spacing.one,
  },
  pressed: {
    opacity: 0.7,
  },
});
