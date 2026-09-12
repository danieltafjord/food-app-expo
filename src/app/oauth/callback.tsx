import { router } from 'expo-router';
import { useEffect } from 'react';

import { ThemedView } from '@/components/themed-view';

/**
 * Landing route for the OAuth redirect (`foodapp://oauth/callback`).
 *
 * The token exchange itself is completed by `expo-auth-session` /
 * `WebBrowser.maybeCompleteAuthSession()` on the sign-in screen; this route only
 * exists so the redirect, which the OS delivers as a deep link, resolves to a
 * real screen instead of expo-router's "Unmatched Route" page (visible as a
 * flash on Android, where the Custom Tab return re-enters through an intent).
 */
export default function OAuthCallbackScreen() {
  useEffect(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, []);

  return <ThemedView style={{ flex: 1 }} />;
}
