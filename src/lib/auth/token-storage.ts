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

const ACCESS_KEY = 'foodapp.auth.access_token';
const REFRESH_KEY = 'foodapp.auth.refresh_token';
const EXPIRES_KEY = 'foodapp.auth.expires_at';

const isWeb = Platform.OS === 'web';

// Storage fallback. SecureStore is native-only, and even on native it can be
// unavailable — notably the iOS Simulator when the build is signed without an
// Apple team, where the Keychain throws "a required entitlement isn't present".
// In those cases we fall back to an in-memory map so the app still works (tokens
// then live for the session only). On web we prefer localStorage. Properly
// signed builds and real devices keep using the Keychain — `nativeFallback`
// stays false and tokens persist securely.
const memoryStore = new Map<string, string>();
let nativeFallback = false;

function noteFallback(error: unknown): void {
  if (!nativeFallback) {
    nativeFallback = true;
    console.warn(
      'SecureStore is unavailable; falling back to in-memory token storage (dev only). ' +
        'Sign-in will not persist across full reloads. Cause:',
      error,
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
      await SecureStore.setItemAsync(key, value);
      return;
    } catch (error) {
      noteFallback(error);
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
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      noteFallback(error);
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
      await SecureStore.deleteItemAsync(key);
      return;
    } catch (error) {
      noteFallback(error);
    }
  }
  memoryStore.delete(key);
}

export async function loadSession(): Promise<StoredSession | null> {
  const accessToken = await getItem(ACCESS_KEY);
  if (!accessToken) {
    return null;
  }
  const refreshToken = await getItem(REFRESH_KEY);
  const expiresRaw = await getItem(EXPIRES_KEY);
  const expiresAt = expiresRaw ? Number(expiresRaw) : null;

  return {
    accessToken,
    refreshToken: refreshToken ?? null,
    expiresAt: expiresAt != null && Number.isFinite(expiresAt) ? expiresAt : null,
  };
}

export async function saveSession(session: StoredSession): Promise<void> {
  await setItem(ACCESS_KEY, session.accessToken);

  if (session.refreshToken) {
    await setItem(REFRESH_KEY, session.refreshToken);
  } else {
    await removeItem(REFRESH_KEY);
  }

  if (session.expiresAt != null) {
    await setItem(EXPIRES_KEY, String(session.expiresAt));
  } else {
    await removeItem(EXPIRES_KEY);
  }
}

export async function clearSession(): Promise<void> {
  await removeItem(ACCESS_KEY);
  await removeItem(REFRESH_KEY);
  await removeItem(EXPIRES_KEY);
}
