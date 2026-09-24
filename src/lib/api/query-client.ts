import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

// React Native has no window focus events, so without this TanStack Query
// believes the app is always in front: polling queries keep firing while the
// app sits in the background. Tie "focused" to the app being active instead.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
    return () => subscription.remove();
  });
}

/**
 * Single client for the app. Defaults tuned for mobile: no window-focus refetch,
 * a short stale window so lists feel fresh, and a single retry to ride out blips.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
