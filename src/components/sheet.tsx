import { isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * On iOS 26 the system draws the sheet surface (glass, turning opaque at full
 * height) and sheets paint no background of their own. A second opaque layer
 * over it can't be blended on the rounded corners: the lighter native surface
 * shows through the anti-aliased edge as a thin line. Older iOS and Android
 * give no surface, so there the sheet paints the app background itself.
 */
export const nativeSheetSurface = isLiquidGlassAvailable();

type SheetScreenProps = {
  /**
   * Drawn inside the sheet: the native header would float over the content.
   * Omit for sheets whose content speaks for itself.
   */
  title?: string;
  children: ReactNode;
  /**
   * `fit` (default) sizes to its content — for the form sheets presented with
   * `sheetAllowedDetents: 'fitToContents'`. `fill` stretches to the detent
   * height so a scrolling list inside can take the remaining space.
   */
  layout?: 'fit' | 'fill';
};

/**
 * Body of a native form-sheet route (`presentation: 'formSheet'`). The system
 * provides the surface, grabber, dimming, swipe-to-dismiss and keyboard
 * avoidance; this only pads the content and clears the home indicator.
 *
 * The root view is kept in the native hierarchy (`collapsable={false}`): if it
 * were flattened, react-native-screens would find a list's ScrollView directly
 * under the sheet container and re-frame it to the sheet's full size, drawing
 * the list over the title (its "ScrollView + optional header" fast path).
 */
export function SheetScreen({ title, children, layout = 'fit' }: SheetScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // The system already keeps the sheet clear of the home indicator; only pad
  // when there is no indicator at all (older devices, Android).
  const bottom = insets.bottom > 0 ? Spacing.two : Spacing.four;
  return (
    <View
      collapsable={false}
      style={[
        styles.body,
        layout === 'fill' && styles.fill,
        { paddingBottom: bottom },
        !nativeSheetSurface && { backgroundColor: theme.background },
      ]}>
      {title ? (
        <ThemedText type="subtitle" numberOfLines={1} style={styles.title}>
          {title}
        </ThemedText>
      ) : null}
      <View style={[styles.content, layout === 'fill' && styles.fill]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: Spacing.four,
    // Clears the grabber the system draws at the top of the sheet.
    paddingTop: Spacing.five,
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
  },
  fill: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
  },
});
