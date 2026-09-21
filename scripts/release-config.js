/**
 * Fail before creating a store binary with missing customer-facing configuration.
 * @param {Record<string, string | undefined>} env
 */
function validateReleaseEnvironment(env) {
  for (const name of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_PRIVACY_URL', 'EXPO_PUBLIC_SUPPORT_URL']) {
    let url;
    try {
      url = new URL(env[name]?.trim() ?? '');
    } catch {
      throw new Error(`${name} must be a public HTTPS URL for production builds.`);
    }
    if (url.protocol !== 'https:' || url.username || url.password ||
      url.hostname === 'localhost' || url.hostname.endsWith('.test') ||
      url.hostname.endsWith('.local') || url.hostname.endsWith('.example')) {
      throw new Error(`${name} must be a public HTTPS URL for production builds.`);
    }
    if (name === 'EXPO_PUBLIC_API_URL' && (url.pathname !== '/' || url.search || url.hash)) {
      throw new Error('EXPO_PUBLIC_API_URL must contain only the backend origin.');
    }
  }
  const client = env.EXPO_PUBLIC_OAUTH_CLIENT_ID?.trim();
  if (!client || client.startsWith('REPLACE_WITH')) {
    throw new Error('EXPO_PUBLIC_OAUTH_CLIENT_ID must identify the production Passport client.');
  }
}

module.exports = { validateReleaseEnvironment };
