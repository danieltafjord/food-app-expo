/**
 * Runtime configuration, sourced from `EXPO_PUBLIC_*` env vars (see `.env.example`).
 *
 * These values are inlined into the app bundle at build time, so they must not
 * contain secrets. The OAuth flow is a *public* PKCE client — there is no client
 * secret to leak.
 */

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

/** Backend origin, e.g. `http://localhost:8000`. Physical devices need a LAN IP. */
export const API_BASE_URL = stripTrailingSlash(
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000',
);

/** Versioned REST surface — every resource endpoint lives under here. */
export const API_V1_URL = `${API_BASE_URL}/api/v1`;

/** Public Passport client id. Register one with `php artisan passport:client --public`. */
export const OAUTH_CLIENT_ID = process.env.EXPO_PUBLIC_OAUTH_CLIENT_ID ?? '';

/** Custom URL scheme (matches `expo.scheme` in app.json) used for the OAuth redirect. */
export const OAUTH_SCHEME = 'foodapp';

/** Path appended to the scheme: `foodapp://oauth/callback`. Must match the registered client. */
export const OAUTH_REDIRECT_PATH = 'oauth/callback';

/** True once the app has a client id to talk to the authorization server. */
export const isOAuthConfigured = OAUTH_CLIENT_ID.length > 0;
