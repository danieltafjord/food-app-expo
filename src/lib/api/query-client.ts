import { QueryClient } from '@tanstack/react-query';

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
