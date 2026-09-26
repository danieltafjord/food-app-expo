import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/lib/auth/session';

/** Which household activity the server pushes to this user. All on by default. */
export type NotificationPreferences = {
  list_items: boolean;
  shopping: boolean;
  plan: boolean;
  household: boolean;
  /** Shopping list ids to stay quiet about. */
  muted_lists: string[];
};

export type NotificationTopic = Exclude<keyof NotificationPreferences, 'muted_lists'>;

export const notificationPreferencesKey = (userId?: number) => ['notification-preferences', userId] as const;

export function useNotificationPreferences() {
  const { user, isAuthenticated, request } = useSession();
  return useQuery({
    queryKey: notificationPreferencesKey(user?.id),
    queryFn: ({ signal }) => request<NotificationPreferences>('/me/notifications', { signal }),
    enabled: isAuthenticated && !!user?.current_household,
    staleTime: 60_000,
  });
}

/**
 * Save a change to the preferences. Applied to the cached copy at once and
 * rolled back if the server refuses.
 */
export function useUpdateNotificationPreferences() {
  const { user, request } = useSession();
  const client = useQueryClient();
  const key = notificationPreferencesKey(user?.id);
  return useMutation({
    scope: { id: 'notification-preferences' },
    mutationFn: (change: Partial<NotificationPreferences>) =>
      request<NotificationPreferences>('/me/notifications', { method: 'PATCH', body: change }),
    onMutate: async (change) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<NotificationPreferences>(key);
      if (previous) client.setQueryData(key, { ...previous, ...change });
      return { previous };
    },
    onError: (_error, _change, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
    },
    onSuccess: (preferences) => client.setQueryData(key, preferences),
  });
}

/** Mute or unmute one shopping list. */
export function useListMute(listId: string) {
  const preferences = useNotificationPreferences().data;
  const update = useUpdateNotificationPreferences();
  const muted = preferences?.muted_lists.includes(listId) ?? false;
  return {
    available: !!preferences,
    muted,
    toggle: () => {
      if (!preferences) return;
      update.mutate({
        muted_lists: muted
          ? preferences.muted_lists.filter((id) => id !== listId)
          : [...preferences.muted_lists, listId],
      });
    },
  };
}
