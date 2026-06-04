import { useEffect, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

const DURATION = 220;

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Extra style for the sheet surface — e.g. a `maxHeight` cap for long, scrolling sheets. */
  sheetStyle?: StyleProp<ViewStyle>;
  /** Vertical gap between the sheet's children. Defaults to `Spacing.three`. */
  contentGap?: number;
};

/**
 * Bottom sheet shown in a transparent Modal. The dim backdrop fades in/out while
 * the sheet slides up/down — animated separately so the backdrop never appears to
 * slide along with the sheet (which is what `Modal animationType="slide"` does).
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  sheetStyle,
  contentGap = Spacing.three,
}: BottomSheetProps) {
  // Keep the native Modal mounted through the close animation so the sheet can slide
  // down and the backdrop fade out, instead of the whole thing vanishing instantly.
  // Re-mounting on open is done during render — React's way to adjust state to a prop.
  const [mounted, setMounted] = useState(visible);

  if (visible && !mounted) {
    setMounted(true);
  }

  useEffect(() => {
    if (visible || !mounted) {
      return;
    }
    // Tear the Modal down once the exit animation has had time to play. A timer (rather
    // than the exit animation's own callback) guarantees cleanup even on platforms where
    // exit callbacks inside a Modal don't fire — a stuck transparent Modal would swallow
    // all touches.
    const timer = setTimeout(() => setMounted(false), DURATION + 60);
    return () => clearTimeout(timer);
  }, [visible, mounted]);

  if (!mounted) {
    return null;
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {visible ? (
          <>
            <Animated.View
              entering={FadeIn.duration(DURATION)}
              exiting={FadeOut.duration(DURATION)}
              style={[StyleSheet.absoluteFill, styles.backdrop]}>
              <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
            </Animated.View>
            <Animated.View
              entering={SlideInDown.duration(DURATION)}
              exiting={SlideOutDown.duration(DURATION)}>
              <ThemedView style={[styles.sheet, sheetStyle]}>
                <SafeAreaView edges={['bottom']} style={[styles.sheetInner, { gap: contentGap }]}>
                  <View style={styles.handle} />
                  {children}
                </SafeAreaView>
              </ThemedView>
            </Animated.View>
          </>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
  },
  sheetInner: {
    padding: Spacing.four,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.4)',
  },
});
