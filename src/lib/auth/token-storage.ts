import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Persisted OAuth session. The access token is a Passport JWT; `expiresAt` is an
 * epoch-ms timestamp so we can refresh proactively without parsing the JWT.
 */
export type StoredSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
};

const SESSION_KEY = 'foodapp.auth.session';

const ACCESS_KEY = 'foodapp.auth.access_token';
const REFRESH_KEY = 'foodapp.auth.refresh_token';
const EXPIRES_KEY = 'foodapp.auth.expires_at';

const isWeb = Platform.OS === 'web';

// Storage fallback. SecureStore is native-only, and even on native it can be
// unavailable — notably the iOS Simulator when the build is signed without an
// Apple team, where the Keychain throws "a required entitlement isn't present".
// ONLY that case falls back to an in-memory map (tokens then live for the
// session only). Any other Keychain error — e.g. the device still locked at a
// background launch — propagates instead of silently switching to memory, which
// would make a later sign-in look persisted when it isn't. On web we prefer
// localStorage. Properly signed builds and real devices keep using the Keychain.
const memoryStore = new Map<string, string>();
let nativeFallback = false;

/** Keychain items stay readable after the first unlock, so a background/locked
 *  launch can still restore the session. */
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

function isEntitlementError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /entitlement/i.test(message);
}

/** Switch to the in-memory fallback for the entitlement case; rethrow anything else. */
function handleNativeError(error: unknown): void {
  if (!isEntitlementError(error)) {
    throw error;
  }
  if (!nativeFallback) {
    nativeFallback = true;
    console.warn(
      'SecureStore is unavailable (missing Keychain entitlement — unsigned simulator build); ' +
        'falling back to in-memory token storage. Sign-in will not persist across full reloads.',
    );
  }
}

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    } else {
      memoryStore.set(key, value);
    }
    return;
  }
  if (!nativeFallback) {
    try {
      await SecureStore.setItemAsync(key, value, secureStoreOptions);
      return;
    } catch (error) {
      handleNativeError(error);
    }
  }
  memoryStore.set(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
    return memoryStore.get(key) ?? null;
  }
  if (!nativeFallback) {
    try {
      return await SecureStore.getItemAsync(key, secureStoreOptions);
    } catch (error) {
      handleNativeError(error);
    }
  }
  return memoryStore.get(key) ?? null;
}

async function removeItem(key: string): Promise<void> {
  if (isWeb) {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    } else {
      memoryStore.delete(key);
    }
    return;
  }
  if (!nativeFallback) {
    try {
      await SecureStore.deleteItemAsync(key, secureStoreOptions);
      return;
    } catch (error) {
      handleNativeError(error);
    }
  }
  memoryStore.delete(key);
}

export async function loadSession(): Promise<StoredSession | null> {
  const stored = await getItem(SESSION_KEY);
  if (stored !== null) {
    const parsed: unknown = JSON.parse(stored);
    if (parsed === null) return null; // Signed-out marker also suppresses legacy credentials.
    if (typeof parsed !== 'object' || !('accessToken' in parsed) ||
      typeof parsed.accessToken !== 'string' || !parsed.accessToken ||
      !('refreshToken' in parsed) || !(parsed.refreshToken === null || typeof parsed.refreshToken === 'string') ||
      !('expiresAt' in parsed) || !(parsed.expiresAt === null || (typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt)))) {
      throw new Error('Invalid stored session');
    }
    return parsed as StoredSession;
  }
  // Migrate the legacy three-key layout on the first successful restore.
  const [accessToken, refreshToken, expiresRaw] = await Promise.all([
    getItem(ACCESS_KEY),
    getItem(REFRESH_KEY),
    getItem(EXPIRES_KEY),
  ]);
  if (!accessToken) {
    return null;
  }
  const expiresAt = expiresRaw ? Number(expiresRaw) : null;

  const session = {
    accessToken,
    refreshToken: refreshToken ?? null,
    expiresAt: expiresAt != null && Number.isFinite(expiresAt) ? expiresAt : null,
  };
  await saveSession(session);
  return session;
}

export async function saveSession(session: StoredSession): Promise<void> {
  // One atomic Keychain value: a crash during rotation cannot mix token generations.
  await setItem(SESSION_KEY, JSON.stringify(session));
  await removeLegacySession();
}

async function removeLegacySession(): Promise<void> {
  await Promise.all([removeItem(ACCESS_KEY), removeItem(REFRESH_KEY), removeItem(EXPIRES_KEY)]);
}

export async function clearSession(): Promise<void> {
  // Keep a signed-out marker so an interrupted legacy cleanup cannot revive a session.
  await setItem(SESSION_KEY, 'null');
  await removeLegacySession();
}
