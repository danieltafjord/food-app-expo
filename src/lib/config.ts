/**
 * Runtime configuration, sourced from `EXPO_PUBLIC_*` env vars (see `.env.example`).
 *
 * These values are inlined into the app bundle at build time, so they must not
 * contain secrets. The OAuth flow is a *public* PKCE client — there is no client
 * secret to leak.
 */

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

/** Dev-only default so a fresh checkout runs against Herd without any env setup. */
const DEV_API_URL = 'http://food-app.test';

function resolveApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) {
    return stripTrailingSlash(configured);
  }
  if (__DEV__) {
    return DEV_API_URL;
  }
  // A release build without a backend URL would silently talk to a dev host;
  // fail at load so the misconfiguration is caught on the first launch.
  throw new Error('EXPO_PUBLIC_API_URL is not set. Configure it in the EAS build profile.');
}

/** Backend origin, e.g. `http://food-app.test`. Physical devices need a LAN IP. */
export const API_BASE_URL = resolveApiBaseUrl();

/** Versioned REST surface — every resource endpoint lives under here. */
export const API_V1_URL = `${API_BASE_URL}/api/v1`;

/** Public Passport client id. Register one with `php artisan passport:client --public`. */
export const OAUTH_CLIENT_ID = process.env.EXPO_PUBLIC_OAUTH_CLIENT_ID ?? '';

/** Custom URL scheme (matches `expo.scheme` in app.json) used for the OAuth redirect. */
export const OAUTH_SCHEME = 'foodapp';

/** Path appended to the scheme: `foodapp://oauth/callback`. Must match the registered client. */
export const OAUTH_REDIRECT_PATH = 'oauth/callback';

/** eas.json ships this sentinel until a real client id is filled in per environment. */
const PLACEHOLDER_PREFIX = 'REPLACE_WITH';

/** True once the app has a real client id to talk to the authorization server. */
export const isOAuthConfigured =
  OAUTH_CLIENT_ID.length > 0 && !OAUTH_CLIENT_ID.startsWith(PLACEHOLDER_PREFIX);
