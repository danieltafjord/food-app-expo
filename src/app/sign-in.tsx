import * as AuthSession from 'expo-auth-session';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api/client';
import { authRequestConfig, discovery, redirectUri } from '@/lib/auth/oauth';
import { useSession } from '@/lib/auth/session';
import { isOAuthConfigured, OAUTH_CLIENT_ID } from '@/lib/config';
import { useT } from '@/lib/i18n';

// Required so the auth popup/redirect can settle the pending session (web + native).
WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const t = useT();
  const theme = useTheme();
  const { signIn } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // We drive the flow off the promise that promptAsync resolves with, rather than
  // the [, response] tuple + an effect — it keeps every setState in this handler
  // (after an await), out of an effect, and reads top-to-bottom.
  const [request, , promptAsync] = AuthSession.useAuthRequest(authRequestConfig, discovery);

  async function exchange(code: string) {
    const token = await AuthSession.exchangeCodeAsync(
      {
        clientId: OAUTH_CLIENT_ID,
        code,
        redirectUri,
        extraParams: request?.codeVerifier ? { code_verifier: request.codeVerifier } : undefined,
      },
      discovery,
    );
    await signIn(token);
  }

  function dismiss() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }

  async function onSignIn() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await promptAsync();
      if (result.type === 'success') {
        if (result.params.code) {
          await exchange(result.params.code);
          dismiss(); // connected — return to Settings; local data is untouched.
          return;
        }
        // The server redirected back with an OAuth error instead of a code.
        if (result.params.error) {
          setError(result.params.error_description ?? result.params.error);
        }
      } else if (result.type === 'error') {
        setError(result.error?.message ?? t('auth.authFailed'));
      }
      // 'cancel' / 'dismiss' / 'locked' need no message — the user backed out.
    } catch (err) {
      // Surface the real reason — token-exchange and network failures hide here otherwise.
      console.error('[sign-in] failed', err);
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error && err.message
            ? err.message
            : t('auth.signInFailed');
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.header}>
          <ThemedText type="title" style={styles.title}>
            {t('auth.title')}
          </ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.subtitle}>
            {t('auth.subtitle')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            {t('auth.cloudSoon')}
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.actions}>
          {!isOAuthConfigured && (
            <ThemedView type="backgroundElement" style={styles.notice}>
              <ThemedText type="smallBold">{t('auth.setupNeeded')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('auth.setupBefore')}
                <ThemedText type="code">EXPO_PUBLIC_OAUTH_CLIENT_ID</ThemedText>
                {t('auth.setupAfter')}
              </ThemedText>
            </ThemedView>
          )}

          {error && (
            <ThemedText type="small" style={[styles.errorText, { color: theme.danger }]}>
              {error}
            </ThemedText>
          )}

          <Button
            title={t('auth.signInCreate')}
            onPress={onSignIn}
            loading={submitting}
            disabled={!request || !isOAuthConfigured}
          />
          <Button title={t('common.notNow')} variant="secondary" onPress={dismiss} disabled={submitting} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            {t('auth.secureHint')}
          </ThemedText>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    justifyContent: 'space-between',
    paddingBottom: Spacing.five,
  },
  header: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
  },
  actions: {
    gap: Spacing.three,
  },
  notice: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  errorText: {
    textAlign: 'center',
  },
  hint: {
    textAlign: 'center',
  },
});
