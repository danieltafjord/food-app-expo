import { type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSyncRefresh } from '@/hooks/use-sync-refresh';

type ScreenProps = {
  children: ReactNode;
  /**
   * Apply the top safe-area inset. Leave `false` for screens shown under a
   * navigation header (the header already clears the notch).
   */
  topInset?: boolean;
  /** Pull-to-refresh (manual cloud sync). On by default; pass `false` for form-only screens. */
  refreshable?: boolean;
  /** Floating content layered over the scroll area (e.g. a FAB), pinned to the screen edges. */
  overlay?: ReactNode;
};

/** Themed, scrollable, width-capped page body that clears the bottom tab bar. */
export function Screen({ children, topInset = true, refreshable = true, overlay }: ScreenProps) {
  const { refreshing, onRefresh } = useSyncRefresh();
  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView edges={topInset ? ['top'] : []} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // Inset the scroll area when the keyboard opens so a focused field
          // below it scrolls into view instead of being hidden behind it.
          automaticallyAdjustKeyboardInsets
          refreshControl={
            refreshable ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            ) : undefined
          }>
          <View style={styles.inner}>{children}</View>
        </ScrollView>
        {overlay}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: BottomTabInset + Spacing.five,
  },
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.four,
    gap: Spacing.four,
  },
});
