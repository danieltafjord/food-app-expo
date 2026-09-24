import { useValue } from '@legendapp/state/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { Household } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { store$ } from '@/lib/store/collections';

export const householdExclusionsKey = (account?: number, household?: number) => ['household-exclusions', account, household] as const;

/** Guest settings persist locally; signed-in households use the shared server value. */
export function useHouseholdIngredientExclusions() {
  const { user, isAuthenticated, request } = useSession();
  const client = useQueryClient();
  const localId = useValue(store$.meta.localHouseholdId);
  const boundHousehold = useValue(store$.meta.serverHouseholdId);
  const local = useValue(() => store$.households[localId].excluded_ingredients.get()) ?? [];
  const householdId = user?.current_household?.id;
  const queryKey = householdExclusionsKey(user?.id, householdId);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => request<Household>(`/households/${householdId}`, { signal }),
    enabled: isAuthenticated && !!householdId,
    staleTime: 0,
    refetchInterval: 30_000,
    retry: false,
  });
  const exclusions = isAuthenticated ? query.data?.excluded_ingredients ?? [] : local;
  useEffect(() => {
    if (query.data && householdId === boundHousehold) {
      store$.households[localId].excluded_ingredients.set(query.data.excluded_ingredients ?? []);
    }
  }, [query.data, householdId, localId, boundHousehold]);
  const update = useMutation({
    scope: { id: `household-exclusions-${householdId ?? localId}` },
    onMutate: async () => { await client.cancelQueries({ queryKey }); },
    mutationFn: async (names: string[]) => {
      if (!isAuthenticated) {
        store$.households[localId].excluded_ingredients.set(names);
        return null;
      }
      if (!query.data || !householdId) throw new Error('Household unavailable');
      return request<Household>(`/households/${householdId}`, {
        method: 'PATCH', body: { name: query.data.name, excluded_ingredients: names },
      });
    },
    onSuccess: (household) => {
      if (household) client.setQueryData(queryKey, household);
      void client.invalidateQueries({ queryKey: ['ingredient-suggestions'] });
    },
  });
  return { exclusions, ready: !isAuthenticated || (query.isSuccess && !query.isError && householdId === boundHousehold), query, update };
}
