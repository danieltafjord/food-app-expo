import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Household, HouseholdMembership, HouseholdRole } from '@/lib/api/types';
import { queryKeys } from '@/lib/api/keys';
import { useSession } from '@/lib/auth/session';
import { applyServerHouseholdSettings } from '@/lib/store';
import { syncNow } from '@/lib/sync/engine';

/** Households the user belongs to, each with the caller's role. */
export function useHouseholds() {
  const { request, isAuthenticated } = useSession();
  return useQuery({
    queryKey: queryKeys.households,
    queryFn: () => request<HouseholdMembership[]>('/households'),
    enabled: isAuthenticated,
  });
}

/**
 * The active household (from `/me`) joined with the caller's role (from the
 * households list), so screens can gate owner-only actions.
 */
export function useActiveHousehold(): {
  household: Household | null;
  role: HouseholdRole | null;
  isOwner: boolean;
} {
  const { user } = useSession();
  const households = useHouseholds();
  const current = user?.current_household ?? null;
  const membership = current ? households.data?.find((h) => h.id === current.id) : undefined;
  const role = membership?.role ?? null;
  return { household: current, role, isOwner: role === 'owner' };
}

export function useCreateHousehold() {
  const { request, refreshUser } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) =>
      request<Household>('/households', { method: 'POST', body: input }),
    onSuccess: async () => {
      // Creating a household makes it active — refresh /me and everything scoped to it.
      await refreshUser();
      await queryClient.invalidateQueries();
      // First link to a server household: kick off the initial upload now rather
      // than waiting for the sync poll.
      syncNow();
    },
  });
}

/**
 * Update the active household's shared settings (name / default servings).
 * The local household is updated optimistically by the caller so the UI flips
 * instantly; this mirrors the change to the server household so the rest of the
 * household sees it. On success we re-adopt the server's canonical value.
 */
export function useUpdateHousehold() {
  const { request } = useSession();
  return useMutation({
    mutationFn: (input: { id: number; name: string; default_servings: number }) =>
      request<Household>(`/households/${input.id}`, {
        method: 'PATCH',
        body: { name: input.name, default_servings: input.default_servings },
      }),
    onSuccess: (household) => {
      applyServerHouseholdSettings(household.default_servings);
    },
  });
}

export function useSwitchHousehold() {
  const { request, refreshUser } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (householdId: number) =>
      request<Household>('/household/switch', {
        method: 'POST',
        body: { household_id: householdId },
      }),
    onSuccess: async () => {
      await refreshUser();
      await queryClient.invalidateQueries();
    },
  });
}
