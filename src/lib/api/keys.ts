/**
 * React Query keys for the cloud-only domains (account + household sharing).
 * Local-first data (dinners, ingredients, plans, shopping lists) lives in the
 * on-device store (`@/lib/store`), not React Query.
 */
export const queryKeys = {
  me: ['me'] as const,
  households: ['households'] as const,
  members: ['household', 'members'] as const,
  invitations: ['household', 'invitations'] as const,
};
