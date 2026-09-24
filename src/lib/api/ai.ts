import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useValue } from '@legendapp/state/react';
import { useRef } from 'react';

import { useSession } from '@/lib/auth/session';
import { store$ } from '@/lib/store/collections';
import { requestAi } from '@/lib/ai-request';

export type AiFeature = 'categorization' | 'suggestions';
export type AiSettings = {
  categorization_enabled: boolean;
  suggestions_enabled: boolean;
  available: boolean;
  email_verified: boolean;
  usage: {
    resets_at: string;
    categorization: AiAllowance;
    suggestions: AiAllowance;
    /** Missing on servers without dinner pictures. */
    images?: AiAllowance;
  };
};
type AiAllowance = {
  remaining: number;
  user: { limit: number; remaining: number };
  household: { limit: number; remaining: number };
};
export type AiPreferences = Pick<AiSettings, 'categorization_enabled' | 'suggestions_enabled'>;
export const aiSettingsKey = (userId?: number, householdId?: number) => ['ai-settings', userId, householdId] as const;

const AI_SETTINGS_POLL_MS = 5 * 60_000;

export function useAiSettings() {
  const { user, isAuthenticated, request } = useSession();
  const query = useQuery({
    queryKey: aiSettingsKey(user?.id, user?.current_household?.id),
    queryFn: ({ signal }) => requestAi<AiSettings>(request, '/ai/settings', { signal }),
    enabled: isAuthenticated && !!user?.current_household,
    retry: false,
    staleTime: 30_000,
    // Pick up opt-ins changed on another device when the app comes back to the
    // front, and every few minutes while it's open; wake exhausted allowances at
    // reset. A root component always watches this, so a tight poll would be a
    // request a minute for every signed-in user.
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const reset = Date.parse(query.state.data?.usage.resets_at ?? '');
      return Number.isFinite(reset) && reset > Date.now()
        ? Math.min(AI_SETTINGS_POLL_MS, Math.max(1000, reset - Date.now() + 1000)) : AI_SETTINGS_POLL_MS;
    },
  });
  // A failed opt-out remains effective on this device until saved successfully.
  const paused = useValue(() => store$.settings.aiPaused.get()?.[String(user?.id)]);
  const settings = query.data ? {
    ...query.data,
    categorization_enabled: query.data.categorization_enabled && !paused?.categorization,
    suggestions_enabled: query.data.suggestions_enabled && !paused?.suggestions,
  } : undefined;
  return { ...query, settings };
}

export function useUpdateAiSettings() {
  const { user, request } = useSession();
  const client = useQueryClient();
  const key = aiSettingsKey(user?.id, user?.current_household?.id);
  const account = String(user?.id);
  const latest = useRef(0);
  return useMutation({
    scope: { id: `ai-settings-${account}` },
    mutationFn: (input: AiPreferences) => requestAi<AiSettings>(request, '/ai/settings', { method: 'PATCH', body: input }),
    onMutate: async (input) => {
      const revision = ++latest.current;
      store$.settings.aiPaused[account].set({
        categorization: !input.categorization_enabled,
        suggestions: !input.suggestions_enabled,
      });
      await client.cancelQueries({ queryKey: key });
      return { revision };
    },
    onSuccess: (settings, _input, context) => {
      if (context?.revision !== latest.current) return;
      client.setQueryData(key, settings);
      store$.settings.aiPaused[account].delete();
    },
  });
}
