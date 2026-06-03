import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type Props = { size?: number };

/**
 * Square thumbnail for a dinner: a neutral tile with a brand-tinted food icon.
 * For now it's the default icon; once dinners carry an image, render it here
 * (e.g. via expo-image) with this as the fallback.
 */
export function DinnerThumbnail({ size = 40 }: Props) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.thumb,
        { width: size, height: size, borderRadius: size / 4, backgroundColor: theme.backgroundSelected },
      ]}>
      <SymbolView
        name="fork.knife"
        size={size * 0.5}
        tintColor={theme.tint}
        type="monochrome"
        fallback={<ThemedText style={{ fontSize: size * 0.5 }}>🍽️</ThemedText>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
