import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { queryClient } from '@/lib/api/query-client';
import { takePendingInvite } from '@/lib/auth/pending-invite';
import { SessionProvider, useSession } from '@/lib/auth/session';
import { StoreProvider } from '@/lib/store';

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
 * (light / dark / system). Themes the navigation chrome + status bar to match
 * the app's neutral palette.
 */
function ThemedRoot({ children }: { children: ReactNode }) {
  const scheme = useResolvedScheme();
  const theme = useTheme();
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
    <ThemeProvider value={navTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { isAuthenticated } = useSession();

  // Resume a deferred invite once the user connects (deep link arrived signed-out).
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    const token = takePendingInvite();
    if (token) {
      router.replace({ pathname: '/invitations/[token]', params: { token } });
    }
  }, [isAuthenticated]);

  // Local-first: (app) always renders — no account required. Boot gating is the
  // store's hydration (StoreProvider), and the session restores in the background.
  // sign-in is an opt-in "connect cloud account" flow presented from Settings;
  // invitations stay reachable via the foodapp://invitations/<token> deep link.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(app)" />
      <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
      <Stack.Screen name="weeks" options={{ presentation: 'modal' }} />
      <Stack.Screen name="invitations/[token]" />
    </Stack>
  );
}
