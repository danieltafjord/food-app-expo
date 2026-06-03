import { useQuery } from '@tanstack/react-query';

import type { Member } from '@/lib/api/types';
import { queryKeys } from '@/lib/api/keys';
import { useSession } from '@/lib/auth/session';

/** Members of the active household. Any member may view; needs an active household. */
export function useMembers(enabled: boolean) {
  const { request } = useSession();
  return useQuery({
    queryKey: queryKeys.members,
    queryFn: () => request<Member[]>('/household/members'),
    enabled,
  });
}
