import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ComponentProps, type ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AiClassificationWorker } from '@/components/ai-classification-worker';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { SchemeContext, useResolvedSchemeSource } from '@/hooks/use-theme';
import { Colors } from '@/constants/theme';
import { queryClient } from '@/lib/api/query-client';
import { SessionProvider } from '@/lib/auth/session';
import { StoreProvider } from '@/lib/store';
import { LocaleContext, useLocaleSource } from '@/lib/store/settings';

// Re-exported so Expo Router renders it instead of a white screen when any route
// in the tree throws during render. See `@/components/error-boundary`.
export { AppErrorBoundary as ErrorBoundary } from '@/components/error-boundary';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <StoreProvider>
            <ThemedRoot>
              <AiClassificationWorker />
              <AnimatedSplashOverlay />
              <RootNavigator />
            </ThemedRoot>
          </StoreProvider>
        </QueryClientProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Lives inside `StoreProvider` so it can resolve the user's theme preference
 * (light / dark / system) and language. Themes the navigation chrome + status
 * bar to match the app's neutral palette, and is the ONE place that subscribes
 * to those settings: everything below reads them from context.
 */
function ThemedRoot({ children }: { children: ReactNode }) {
  const scheme = useResolvedSchemeSource();
  const locale = useLocaleSource();
  const theme = Colors[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: theme.background,
      card: theme.background,
      text: theme.text,
      border: theme.border,
      primary: theme.tint,
    },
  };

  return (
    <SchemeContext value={scheme}>
      <LocaleContext value={locale}>
        <ThemeProvider value={navTheme}>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          {children}
        </ThemeProvider>
      </LocaleContext>
    </SchemeContext>
  );
}

type ScreenOptions = ComponentProps<typeof Stack.Screen>['options'];

/** A sheet sized to its content (short forms). */
const formSheet: ScreenOptions = {
  presentation: 'formSheet',
  headerShown: false,
  sheetAllowedDetents: 'fitToContents',
  sheetGrabberVisible: true,
  sheetCornerRadius: 24,
};

/** A sheet with a scrolling list: opens at 60%, pulls up to full height. */
const listSheet: ScreenOptions = {
  ...formSheet,
  sheetAllowedDetents: [0.6, 1],
  sheetInitialDetentIndex: 0,
  // The list is laid out by flex inside the sheet, not pinned by the system, so
  // expanding is done with the grabber rather than by over-scrolling.
  sheetExpandsWhenScrolledToEdge: false,
};

function RootNavigator() {
  // A deferred invite (deep link opened while signed out) is resumed by the
  // sign-in screen itself right after `signIn()` — see `src/app/sign-in.tsx`.
  // The pending token is in-memory only, so there is no launch-restore case to
  // handle here; a restored session never has one.

  // Local-first: (app) always renders — no account required. Boot gating is the
  // store's hydration (StoreProvider), and the session restores in the background.
  // sign-in is an opt-in "connect cloud account" flow presented from Settings;
  // invitations stay reachable via the foodapp://invitations/<token> deep link.
  return (
    // `freezeOnBlur`: a screen underneath a pushed one (the lists screen under
    // a list, the whole app under a sheet) stops re-rendering on store changes
    // until it is on top again — it catches up in one render on return.
    <Stack screenOptions={{ headerShown: false, freezeOnBlur: true }}>
      <Stack.Screen name="(app)" />
      <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
      <Stack.Screen name="weeks" options={{ presentation: 'modal' }} />
      <Stack.Screen name="invitations/[token]" />
      <Stack.Screen name="oauth/callback" options={{ animation: 'none' }} />

      {/* Bottom sheets are native form sheets: the system owns the surface,
          dimming, grabber, swipe-to-dismiss and keyboard avoidance, and they
          present above the native tab bar (a JS Modal renders beneath it). */}
      <Stack.Screen name="sheets/rename-list" options={formSheet} />
      <Stack.Screen name="sheets/entry-editor" options={formSheet} />
      <Stack.Screen name="sheets/shopping-item" options={formSheet} />
      <Stack.Screen name="sheets/dinner-picker" options={listSheet} />
      <Stack.Screen name="sheets/ingredient-picker" options={listSheet} />
    </Stack>
  );
}
