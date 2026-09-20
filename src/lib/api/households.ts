import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Household, HouseholdMembership, HouseholdRole } from '@/lib/api/types';
import { queryKeys } from '@/lib/api/keys';
import { useSession } from '@/lib/auth/session';
import { applyServerHouseholdSettings } from '@/lib/store';
import {
  adoptServerHousehold,
  ensureSyncedBeforeRebind,
  flushPendingChanges,
  SyncPendingError,
} from '@/lib/sync/engine';

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
    mutationFn: async (input: { name: string }) => {
      // The new household becomes active and replaces the local copy.
      await ensureSyncedBeforeRebind();
      return request<Household>('/households', { method: 'POST', body: input });
    },
    onSuccess: async (household) => {
      // Creating a household makes it active — refresh /me and everything scoped to it.
      await refreshUser();
      await queryClient.invalidateQueries();
      // Bind this device to the new household and start the first upload now
      // rather than waiting for the sync poll.
      await adoptServerHousehold(household.id);
    },
  });
}

/**
 * Update the active household's shared settings (name / default servings).
 * The local household is updated optimistically by the caller so the UI flips
 * instantly; this mirrors the change to the server household so the rest of the
 * household sees it. On success we re-adopt the server's canonical value.
 */
// The newest household update started. Responses to older ones are stale: the
// local value has already moved on (three quick stepper taps), and applying
// them would make it jump backwards.
let latestHouseholdUpdate = 0;

export function useUpdateHousehold() {
  const { request } = useSession();
  return useMutation({
    onMutate: () => ({ seq: ++latestHouseholdUpdate }),
    mutationFn: (input: { id: number; name: string; default_servings: number }) =>
      request<Household>(`/households/${input.id}`, {
        method: 'PATCH',
        body: { name: input.name, default_servings: input.default_servings },
      }),
    onSuccess: (household, _input, context) => {
      if (context?.seq !== latestHouseholdUpdate) return;
      applyServerHouseholdSettings(household.default_servings);
    },
  });
}

/**
 * Switch the active household. The local copy belongs to the current household,
 * so it is pushed first (refusing the switch with `SyncPendingError` if that
 * fails) and then replaced by the new household's data.
 */
export function useSwitchHousehold() {
  const { request, refreshUser } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (householdId: number) => {
      if (!(await flushPendingChanges())) {
        throw new SyncPendingError();
      }
      return request<Household>('/household/switch', {
        method: 'POST',
        body: { household_id: householdId },
      });
    },
    onSuccess: async (household) => {
      await refreshUser();
      await queryClient.invalidateQueries();
      await adoptServerHousehold(household.id);
    },
  });
}
