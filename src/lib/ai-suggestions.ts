import { queryOptions } from '@tanstack/react-query';

import { requestAi } from '@/lib/ai-request';
import type { SyncRequest } from '@/lib/sync/auth-bridge';

/** The UI explicitly refetches these options; mounting or editing never spends quota. */
export function suggestionQueryOptions(
  request: SyncRequest, queryKey: readonly unknown[], context: string, onSettled: () => void,
) {
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        const result = await requestAi<{ ingredients: unknown }>(request, '/ai/suggest', {
          method: 'POST', body: JSON.parse(context), signal,
        });
        if (!Array.isArray(result?.ingredients) || result.ingredients.length > 3
          || result.ingredients.some((item) => typeof item !== 'string' || !item.trim() || item.length > 80 || /[\r\n<>]/.test(item))) {
          throw new Error('Invalid suggestions response');
        }
        return { ingredients: [...new Set((result.ingredients as string[]).map((item) => item.trim()))] };
      } finally {
        onSettled();
      }
    },
    enabled: false,
    retry: false,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}
