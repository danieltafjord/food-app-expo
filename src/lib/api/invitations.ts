import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Household, Invitation, HouseholdRole } from '@/lib/api/types';
import { queryKeys } from '@/lib/api/keys';
import { useSession } from '@/lib/auth/session';
import { adoptServerHousehold } from '@/lib/sync/engine';

/** Invitations for the active household. Owner-only on the backend. */
export function useInvitations(enabled: boolean) {
  const { request } = useSession();
  return useQuery({
    queryKey: queryKeys.invitations,
    queryFn: () => request<Invitation[]>('/household/invitations'),
    enabled,
  });
}

export function useInviteMember() {
  const { request } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: HouseholdRole }) =>
      request<Invitation>('/household/invitations', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invitations }),
  });
}

export function useRevokeInvitation() {
  const { request } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/household/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invitations }),
  });
}

/**
 * Accept an invitation by its email token. Not household-scoped — the invited
 * user may have no active household yet, so on success we refresh everything.
 */
export function useAcceptInvitation() {
  const { request, refreshUser } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      request<Household>(`/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' }),
    onSuccess: async (household) => {
      await refreshUser();
      await queryClient.invalidateQueries();
      // Joined a household — bind this device to it, pull its data and upload
      // local rows immediately.
      await adoptServerHousehold(household.id);
    },
  });
}

export function useDeclineInvitation() {
  const { request } = useSession();
  return useMutation({
    mutationFn: (token: string) =>
      request<{ message: string }>(`/invitations/${encodeURIComponent(token)}/decline`, {
        method: 'POST',
      }),
  });
}
