import * as AuthSession from 'expo-auth-session';

import { API_BASE_URL, OAUTH_CLIENT_ID, OAUTH_REDIRECT_PATH, OAUTH_SCHEME } from '@/lib/config';
import type { StoredSession } from '@/lib/auth/token-storage';

/**
 * Passport's OAuth2 endpoints. There is no discovery document to fetch — the
 * paths are fixed, so we declare them directly.
 */
export const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `${API_BASE_URL}/oauth/authorize`,
  tokenEndpoint: `${API_BASE_URL}/oauth/token`,
};

/** `foodapp://oauth/callback` in a standalone/dev build; an Expo proxy URL in Expo Go. */
export const redirectUri = AuthSession.makeRedirectUri({
  scheme: OAUTH_SCHEME,
  path: OAUTH_REDIRECT_PATH,
});

/**
 * Config for `useAuthRequest`. PKCE is on (public client, no secret), and we
 * request no explicit scopes — a Passport token then grants full API access.
 */
export const authRequestConfig: AuthSession.AuthRequestConfig = {
  clientId: OAUTH_CLIENT_ID,
  redirectUri,
  responseType: AuthSession.ResponseType.Code,
  usePKCE: true,
  scopes: [],
};

/** Normalize a `TokenResponse` into the value we persist. `issuedAt` is in seconds. */
export function tokenResponseToSession(token: AuthSession.TokenResponse): StoredSession {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? null,
    expiresAt: token.expiresIn != null ? (token.issuedAt + token.expiresIn) * 1000 : null,
  };
}

/** Exchange a refresh token for a fresh access (+ rotated refresh) token. */
export async function refreshSession(refreshToken: string): Promise<StoredSession> {
  const token = await AuthSession.refreshAsync(
    { clientId: OAUTH_CLIENT_ID, refreshToken },
    discovery,
  );
  return tokenResponseToSession(token);
}
