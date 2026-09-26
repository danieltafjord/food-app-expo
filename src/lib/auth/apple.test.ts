/* eslint-disable import/first -- mock native modules before loading the module */
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: jest.fn(),
}));
jest.mock('expo-auth-session', () => ({
  TokenResponse: { fromQueryParams: (params: Record<string, unknown>) => ({ accessToken: params.access_token, refreshToken: params.refresh_token }) },
}));
jest.mock('@/lib/auth/oauth', () => ({ discovery: { tokenEndpoint: 'https://api.test/oauth/token' } }));
jest.mock('@/lib/config', () => ({ OAUTH_CLIENT_ID: 'mobile-client' }));

import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { ApiError } from '@/lib/api/client';
import { APPLE_GRANT_TYPE, signInWithApple } from './apple';

const signInAsync = jest.mocked(AppleAuthentication.signInAsync);
const fetchMock = jest.fn();

beforeEach(() => {
  signInAsync.mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

function credential(overrides: Partial<AppleAuthentication.AppleAuthenticationCredential> = {}) {
  return {
    user: 'apple-user',
    identityToken: 'identity-token',
    authorizationCode: 'auth-code',
    fullName: { givenName: 'Kari', familyName: 'Nordmann' },
    email: null,
    state: null,
    realUserStatus: 1,
    ...overrides,
  } as AppleAuthentication.AppleAuthenticationCredential;
}

it('gives Apple the hash of the nonce and the backend the raw nonce', async () => {
  signInAsync.mockResolvedValue(credential());
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'access', refresh_token: 'refresh' }) });

  await expect(signInWithApple()).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });

  const [url, init] = fetchMock.mock.calls[0];
  const sent = Object.fromEntries(new URLSearchParams(init.body));
  expect(url).toBe('https://api.test/oauth/token');
  expect(sent).toEqual({
    grant_type: APPLE_GRANT_TYPE,
    client_id: 'mobile-client',
    identity_token: 'identity-token',
    nonce: expect.any(String),
    authorization_code: 'auth-code',
    given_name: 'Kari',
    family_name: 'Nordmann',
  });
  // expo-crypto's mock hashes with node's crypto.
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, sent.nonce);
  expect(hashed).toMatch(/^[0-9a-f]{64}$/);
  expect(signInAsync.mock.calls[0][0]?.nonce).toBe(hashed);
});

it('leaves out the name Apple only shares on the first sign-in', async () => {
  signInAsync.mockResolvedValue(credential({ fullName: null }));
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'access' }) });

  await signInWithApple();

  const sent = Object.fromEntries(new URLSearchParams(fetchMock.mock.calls[0][1].body));
  expect(sent).not.toHaveProperty('given_name');
  expect(sent).not.toHaveProperty('family_name');
});

it('resolves null when the user closes Apple’s sheet', async () => {
  signInAsync.mockRejectedValue(Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }));

  await expect(signInWithApple()).resolves.toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('surfaces the backend’s reason when it refuses the sign-in', async () => {
  signInAsync.mockResolvedValue(credential());
  fetchMock.mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ error: 'invalid_grant', hint: 'This account has been deactivated.' }),
  });

  const failure = signInWithApple();
  await expect(failure).rejects.toBeInstanceOf(ApiError);
  await expect(failure).rejects.toThrow('This account has been deactivated.');
});
