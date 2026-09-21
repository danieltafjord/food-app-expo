import { useMutation } from '@tanstack/react-query';

import type { Locale } from '@/lib/i18n';
import type { User } from '@/lib/api/types';
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
