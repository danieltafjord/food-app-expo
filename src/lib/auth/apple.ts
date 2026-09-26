import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';

import { ApiError, requestLocale } from '@/lib/api/client';
import { discovery } from '@/lib/auth/oauth';
import { OAUTH_CLIENT_ID } from '@/lib/config';

/** The backend's Passport grant that trades an Apple identity token for our tokens. */
export const APPLE_GRANT_TYPE = 'urn:handlelista:params:oauth:grant-type:apple';

/** What the backend needs to check a Sign in with Apple result. */
export type AppleProof = {
  identity_token: string;
  /** The raw nonce; Apple signed its SHA-256 into the identity token. */
  nonce: string;
  authorization_code?: string;
};

/**
 * Show Apple's sign-in sheet. Resolves null when the user cancels.
 *
 * A fresh nonce binds the identity token to this one sign-in: Apple gets its
 * hash, the backend gets the raw value and checks they match, so a token
 * captured elsewhere cannot be replayed.
 */
export async function requestAppleCredential(): Promise<{ proof: AppleProof; fullName: AppleAuthentication.AppleAuthenticationFullName | null } | null> {
  const nonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ERR_REQUEST_CANCELED') {
      return null;
    }
    throw err;
  }

  if (!credential.identityToken) {
    throw new Error('Apple did not return an identity token');
  }

  return {
    proof: {
      identity_token: credential.identityToken,
      nonce,
      authorization_code: credential.authorizationCode ?? undefined,
    },
    fullName: credential.fullName,
  };
}

/**
 * Sign in with Apple and exchange the result for our access + refresh tokens.
 * Resolves null when the user cancels. The name is only shared by Apple on
 * the very first sign-in, so it is passed along for the new account.
 */
export async function signInWithApple(): Promise<AuthSession.TokenResponse | null> {
  const credential = await requestAppleCredential();
  if (!credential) {
    return null;
  }

  const { proof, fullName } = credential;
  const params: Record<string, string> = {
    grant_type: APPLE_GRANT_TYPE,
    client_id: OAUTH_CLIENT_ID,
    identity_token: proof.identity_token,
    nonce: proof.nonce,
  };
  if (proof.authorization_code) params.authorization_code = proof.authorization_code;
  if (fullName?.givenName) params.given_name = fullName.givenName;
  if (fullName?.familyName) params.family_name = fullName.familyName;

  const response = await fetch(discovery.tokenEndpoint!, {
    method: 'POST',
    // In the app's language, so a refusal (`hint`) reads like the rest of the app.
    headers: {
      Accept: 'application/json',
      'Accept-Language': requestLocale(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || typeof body.access_token !== 'string') {
    // `hint` carries the server's reason (e.g. a deactivated account).
    const reason = typeof body.hint === 'string' && body.hint ? body.hint : 'Sign in with Apple failed';
    throw new ApiError(response.ok ? 502 : response.status, reason, undefined, body);
  }

  return AuthSession.TokenResponse.fromQueryParams(body);
}
