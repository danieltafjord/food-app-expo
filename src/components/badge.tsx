import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BadgeColors, Spacing, type BadgeTone } from '@/constants/theme';
import { useResolvedScheme } from '@/hooks/use-theme';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const scheme = useResolvedScheme();
  const colors = BadgeColors[scheme][tone];
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <ThemedText type="small" style={[styles.text, { color: colors.fg }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.three,
  },
  text: {
    fontSize: 12,
    fontWeight: 700,
  },
});
