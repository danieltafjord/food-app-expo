import { useMutation } from '@tanstack/react-query';

import type { Locale } from '@/lib/i18n';
import type { User } from '@/lib/api/types';
import type { AppleProof } from '@/lib/auth/apple';
import { useSession } from '@/lib/auth/session';
import { applyServerSettings, type ThemePreference } from '@/lib/store';

/**
 * Persist the user's app settings to the backend. The local store is updated
 * optimistically by the caller (so the UI flips instantly); this mirrors the
 * change to the user's account so it follows them across devices. On success we
 * re-apply the server's canonical values.
 */
// The newest settings update started; responses to older ones are stale and
// would flip the theme or language back to a choice the user already left.
let latestSettingsUpdate = 0;

export function useUpdateSettings() {
  const { request } = useSession();
  return useMutation({
    scope: { id: 'user-settings' },
    onMutate: () => ({ seq: ++latestSettingsUpdate }),
    mutationFn: (input: { theme: ThemePreference; locale: Locale }) =>
      request<User>('/me/settings', { method: 'PATCH', body: input }),
    onSuccess: (user, _input, context) => {
      if (context?.seq !== latestSettingsUpdate) return;
      applyServerSettings(user.theme, user.locale);
    },
  });
}

/** Change the signed-in person's display name (what the household sees), then reload `/me`. */
export function useUpdateProfile() {
  const { request, refreshUser } = useSession();
  return useMutation({
    mutationFn: (input: { name: string }) =>
      request<User>('/me/profile', { method: 'PATCH', body: input }),
    onSuccess: () => refreshUser().catch(() => undefined),
  });
}

/**
 * How the person proves it's them before the account is deleted: a fresh Sign
 * in with Apple, their password, or — for accounts without one (Google) — their
 * email address typed out.
 */
export type DeleteAccountProof =
  | AppleProof
  | { password: string }
  | { email: string };

/**
 * Delete the account, then sign this device out as the person's own choice —
 * waiting for the dead token's 401 would read as an expired session. Local
 * data stays until the person clears it.
 */
export function useDeleteAccount() {
  const { request, signOut } = useSession();
  return useMutation({
    mutationFn: (proof: DeleteAccountProof) => request<void>('/me', { method: 'DELETE', body: proof }),
    onSuccess: () => signOut().catch(() => undefined),
  });
}
