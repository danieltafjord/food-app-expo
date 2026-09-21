/* eslint-disable import/first -- mock native storage before loading the module */
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'after-first-unlock',
  getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { clearSession, loadSession, saveSession } from './token-storage';

let storage: Map<string, string>;
const session = { accessToken: 'access', refreshToken: 'refresh', expiresAt: 1234 };

beforeEach(() => {
  storage = new Map();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => storage.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { storage.set(key, value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { storage.delete(key); });
});

it('stores the whole token generation atomically', async () => {
  await saveSession(session);
  expect(storage.size).toBe(1);
  await expect(loadSession()).resolves.toEqual(session);
});

it('migrates legacy credentials without losing the refresh token', async () => {
  storage.set('foodapp.auth.access_token', 'access');
  storage.set('foodapp.auth.refresh_token', 'refresh');
  storage.set('foodapp.auth.expires_at', '1234');
  await expect(loadSession()).resolves.toEqual(session);
  expect(storage.size).toBe(1);
});

it('cannot restore legacy credentials after interrupted sign-out cleanup', async () => {
  storage.set('foodapp.auth.access_token', 'legacy');
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Keychain busy'));
  await expect(clearSession()).rejects.toThrow('Keychain busy');
  await expect(loadSession()).resolves.toBeNull();
});

it('preserves the previous complete token generation if a new write fails', async () => {
  await saveSession(session);
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Keychain busy'));
  await expect(saveSession({ ...session, accessToken: 'new' })).rejects.toThrow('Keychain busy');
  await expect(loadSession()).resolves.toEqual(session);
});

it('rejects malformed persisted credentials', async () => {
  storage.set('foodapp.auth.session', JSON.stringify({ accessToken: 42 }));
  await expect(loadSession()).rejects.toThrow('Invalid stored session');
});
