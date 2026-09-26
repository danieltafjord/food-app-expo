import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { ApiError, apiRequest } from '@/lib/api/client';
import type { User } from '@/lib/api/types';
import { signInWithApple } from '@/lib/auth/apple';
import { authRequestConfig, discovery, googleAuthRequestConfig, redirectUri } from '@/lib/auth/oauth';
import { takePendingInvite } from '@/lib/auth/pending-invite';
import { useSession } from '@/lib/auth/session';
import { isOAuthConfigured, OAUTH_CLIENT_ID } from '@/lib/config';
import { useT } from '@/lib/i18n';
import { hasPending } from '@/lib/sync/engine';
import { accountTransitionFor, bindAccount, resetLocalDataForAccount } from '@/lib/store';

// Required so the auth popup/redirect can settle the pending session (web + native).
WebBrowser.maybeCompleteAuthSession();

/** Sign in with Apple is native to iOS; on other platforms people use Google or email. */
const APPLE_SIGN_IN = Platform.OS === 'ios';

type Method = 'apple' | 'google' | 'email';

export default function SignInScreen() {
  const t = useT();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const { signIn } = useSession();
  const [pending, setPending] = useState<Method | null>(null);
  const [error, setError] = useState<string | null>(null);

  // We drive the flow off the promise that promptAsync resolves with, rather than
  // the [, response] tuple + an effect — it keeps every setState in this handler
  // (after an await), out of an effect, and reads top-to-bottom.
  // Google is the same browser sign-in, told to go straight on to Google.
  const [emailRequest, , promptEmail] = AuthSession.useAuthRequest(authRequestConfig, discovery);
  const [googleRequest, , promptGoogle] = AuthSession.useAuthRequest(googleAuthRequestConfig, discovery);
  const browserReady = !!emailRequest && !!googleRequest && isOAuthConfigured;

  function exchange(code: string, request: AuthSession.AuthRequest): Promise<AuthSession.TokenResponse> {
    return AuthSession.exchangeCodeAsync(
      {
        clientId: OAUTH_CLIENT_ID,
        code,
        redirectUri,
        extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined,
      },
      discovery,
    );
  }

  function confirmAccountSwitch(email: string): Promise<boolean> {
    // Unsynced edits belong to the other account and cannot be uploaded from
    // here, so the usual "they stay safe" promise would be untrue for them.
    const message = hasPending()
      ? `${t('auth.switchAccountMessage', { email })}\n\n${t('auth.switchAccountUnsynced')}`
      : t('auth.switchAccountMessage', { email });
    return new Promise((resolve) => {
      Alert.alert(
        t('auth.switchAccountTitle'),
        message,
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
          {
            text: t('auth.switchAccountConfirm'),
            style: 'destructive',
            onPress: () => resolve(true),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }

  // Bind the local data to this account before the session (and the sync engine)
  // start. If the device's data belongs to a *different* account, wipe it first —
  // with the user's confirmation — so one account's data never uploads into
  // another. Returns false if the user backs out of a switch (data left untouched).
  async function reconcileLocalData(accessToken: string): Promise<boolean> {
    const me = await apiRequest<User>('/me', { accessToken });
    if (accountTransitionFor(me.id) === 'switch') {
      const confirmed = await confirmAccountSwitch(me.email);
      if (!confirmed) {
        return false;
      }
      resetLocalDataForAccount(me.id);
    } else {
      bindAccount(me.id);
    }
    return true;
  }

  function dismiss() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }

  // Commit a new session: reconcile local data with the account first, then
  // hand over to the session. This screen owns the post-sign-in navigation. If
  // the user came from an invite link (deferred while signed out), resume it
  // now — doing that from a root effect races with `dismiss()` and loses the token.
  async function completeSignIn(token: AuthSession.TokenResponse) {
    if (!(await reconcileLocalData(token.accessToken))) {
      return;
    }
    await signIn(token);
    const invite = takePendingInvite();
    if (invite) {
      router.replace({ pathname: '/invitations/[token]', params: { token: invite } });
    } else {
      dismiss(); // connected — return to Settings.
    }
  }

  async function run(method: Method, flow: () => Promise<void>) {
    setError(null);
    setPending(method);
    try {
      await flow();
    } catch (err) {
      // Surface the real reason — token-exchange and network failures hide here
      // otherwise. The user sees `message`; the log is dev-only so we don't ship it.
      if (__DEV__) {
        console.error('[sign-in] failed', err);
      }
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error && err.message
            ? err.message
            : t('auth.signInFailed');
      setError(message);
    } finally {
      setPending(null);
    }
  }

  function onBrowserSignIn(method: 'google' | 'email') {
    const request = method === 'google' ? googleRequest : emailRequest;
    const promptAsync = method === 'google' ? promptGoogle : promptEmail;
    return run(method, async () => {
      if (!request) {
        return;
      }
      const result = await promptAsync();
      if (result.type === 'success') {
        if (result.params.code) {
          await completeSignIn(await exchange(result.params.code, request));
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
    });
  }

  function onAppleSignIn() {
    return run('apple', async () => {
      const token = await signInWithApple();
      // null: the user closed Apple's sheet.
      if (token) {
        await completeSignIn(token);
      }
    });
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

          {APPLE_SIGN_IN && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={
                scheme === 'dark'
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={Spacing.three}
              style={[styles.appleButton, (pending !== null || !isOAuthConfigured) && styles.disabled]}
              onPress={() => {
                if (pending === null && isOAuthConfigured) void onAppleSignIn();
              }}
            />
          )}
          <Button
            title={t('auth.continueWithGoogle')}
            variant="secondary"
            onPress={() => onBrowserSignIn('google')}
            loading={pending === 'google'}
            disabled={!browserReady || (pending !== null && pending !== 'google')}
          />
          <Button
            title={t('auth.continueWithEmail')}
            variant="secondary"
            onPress={() => onBrowserSignIn('email')}
            loading={pending === 'email'}
            disabled={!browserReady || (pending !== null && pending !== 'email')}
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            {t('auth.secureHint')}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={dismiss}
            disabled={pending !== null}
            hitSlop={Spacing.two}
            style={styles.notNow}>
            <ThemedText type="default" themeColor="textSecondary">
              {t('common.notNow')}
            </ThemedText>
          </Pressable>
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
  appleButton: {
    height: 52,
  },
  disabled: {
    opacity: 0.5,
  },
  notNow: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
  },
});
