import { type ErrorBoundaryProps } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { en } from '@/lib/i18n/en';
import { getDeviceLocale } from '@/lib/i18n/locale';
import { nb } from '@/lib/i18n/nb';

/**
 * App-wide error boundary, exported from the root layout so a render crash shows
 * a recoverable screen instead of a white screen of death.
 *
 * Deliberately provider-independent: it can render when the very thing that
 * failed is a provider (store / theme / session), so it reads colors from the
 * static palette via React Native's `useColorScheme`, and picks its language
 * straight from the device locale — never the store-backed `useTheme`/`useT`.
 */
export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const c = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const t = getDeviceLocale() === 'nb' ? nb : en;

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.content}>
        <SymbolView
          name="exclamationmark.triangle.fill"
          size={44}
          tintColor={c.danger}
          type="monochrome"
        />
        <Text style={[styles.title, { color: c.text }]}>{t.error.title}</Text>
        <Text style={[styles.message, { color: c.textSecondary }]}>{t.error.message}</Text>
        {error?.message ? (
          <Text style={[styles.detail, { color: c.textSecondary }]} numberOfLines={3}>
            {error.message}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: c.tint },
            pressed && styles.pressed,
          ]}>
          <Text style={[styles.buttonLabel, { color: c.onTint }]}>{t.error.retry}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
  },
  content: {
    alignItems: 'center',
    gap: Spacing.three,
    maxWidth: 420,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  detail: {
    fontSize: 12,
    fontFamily: 'Courier',
    textAlign: 'center',
    opacity: 0.7,
  },
  button: {
    marginTop: Spacing.two,
    minHeight: 52,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
});
