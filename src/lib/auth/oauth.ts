import * as AuthSession from 'expo-auth-session';

import { API_BASE_URL, OAUTH_CLIENT_ID, OAUTH_REDIRECT_PATH, OAUTH_SCHEME } from '@/lib/config';
import { ApiError } from '@/lib/api/client';
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

/**
 * The same sign-in, with a hint that makes the backend's login page go straight
 * on to Google instead of showing the email form.
 */
export const googleAuthRequestConfig: AuthSession.AuthRequestConfig = {
  ...authRequestConfig,
  extraParams: { provider: 'google' },
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
export async function refreshSession(refreshToken: string, signal?: AbortSignal): Promise<StoredSession> {
  const response = await fetch(discovery.tokenEndpoint!, {
    method: 'POST', signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: OAUTH_CLIENT_ID, refresh_token: refreshToken }).toString(),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new ApiError(body.error === 'invalid_grant' ? 401 : response.status, 'Unable to refresh session');
  }
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new ApiError(502, 'Invalid token response');
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? refreshToken,
    expiresAt: typeof body.expires_in === 'number' ? Date.now() + body.expires_in * 1000 : null,
  };
}
