import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

type SheetScreenProps = {
  /** Drawn inside the sheet: the native header would float over the content. */
  title: string;
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
  const insets = useSafeAreaInsets();
  // The system already keeps the sheet clear of the home indicator; only pad
  // when there is no indicator at all (older devices, Android).
  const bottom = insets.bottom > 0 ? Spacing.two : Spacing.four;
  return (
    <ThemedView
      collapsable={false}
      style={[styles.body, layout === 'fill' && styles.fill, { paddingBottom: bottom }]}>
      <ThemedText type="subtitle" numberOfLines={1} style={styles.title}>
        {title}
      </ThemedText>
      <View style={[styles.content, layout === 'fill' && styles.fill]}>{children}</View>
    </ThemedView>
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
