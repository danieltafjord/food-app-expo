import { ApiError } from '@/lib/api/client';
import { SessionController } from './session-controller';
import type { StoredSession } from './token-storage';

const session: StoredSession = { accessToken: 'old', refreshToken: 'refresh', expiresAt: null };
const rotated: StoredSession = { ...session, accessToken: 'new', refreshToken: 'rotated' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const dependencies = {
    save: jest.fn(async (_session: StoredSession) => {}),
    clear: jest.fn(async () => {}),
    refresh: jest.fn(async (_token: string, _signal?: AbortSignal) => rotated),
    request: jest.fn<Promise<any>, [string, any]>(async () => ({ ok: true })),
    onChange: jest.fn(),
  };
  return { ...dependencies, controller: new SessionController(dependencies) };
}

it('shares proactive refreshes across concurrent requests', async () => {
  const { controller, refresh, request } = setup();
  const pending = deferred<StoredSession>();
  refresh.mockReturnValue(pending.promise);
  await controller.set({ ...session, expiresAt: 0 });
  const first = controller.request('/me');
  const second = controller.request('/households');
  expect(refresh).toHaveBeenCalledTimes(1);
  pending.resolve(rotated);
  await Promise.all([first, second]);
  expect(request.mock.calls.map(([, options]) => options.accessToken)).toEqual(['new', 'new']);
});

it('clears a proactively expired session when the refresh token is rejected', async () => {
  const { controller, refresh, clear, onChange } = setup();
  await controller.set({ ...session, expiresAt: 0 });
  refresh.mockRejectedValue({ code: 'invalid_grant' });
  await expect(controller.request('/me')).rejects.toEqual({ code: 'invalid_grant' });
  expect(clear).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it('keeps the session after a temporary refresh failure', async () => {
  const { controller, refresh, clear } = setup();
  await controller.set({ ...session, expiresAt: 0 });
  refresh.mockRejectedValueOnce(new TypeError('Offline'));
  await expect(controller.request('/me')).rejects.toThrow('Offline');
  expect(clear).not.toHaveBeenCalled();
  await expect(controller.request('/me')).resolves.toEqual({ ok: true });
});

it.each([new ApiError(500, 'Server error'), new ApiError(422, 'Invalid input'), new TypeError('Offline')])(
  'does not sign out when the retried request fails for a non-auth reason: %s', async (error) => {
    const { controller, request, clear } = setup();
    await controller.set(session);
    request.mockRejectedValueOnce(new ApiError(401, 'Expired')).mockRejectedValueOnce(error);
    await expect(controller.request('/me')).rejects.toBe(error);
    expect(clear).not.toHaveBeenCalled();
  },
);

it('does not restore credentials when a refresh completes after sign-out', async () => {
  const { controller, refresh, save, onChange } = setup();
  const pending = deferred<StoredSession>();
  refresh.mockReturnValue(pending.promise);
  await controller.set({ ...session, expiresAt: 0 });
  const oldRequest = controller.request('/me');
  const assertion = expect(oldRequest).rejects.toThrow('Session changed');
  await controller.signOut();
  pending.resolve(rotated);
  await assertion;
  expect(save).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it('discards successful responses from a previous account', async () => {
  const { controller, request } = setup();
  const pending = deferred<unknown>();
  await controller.set(session);
  request.mockReturnValueOnce(pending.promise);
  const oldRequest = controller.request('/me');
  const assertion = expect(oldRequest).rejects.toThrow('Session changed');
  await controller.set(rotated);
  pending.resolve({ email: 'previous@example.com' });
  await assertion;
});

it('serializes credential removal after an already-running save', async () => {
  const { controller, save, clear } = setup();
  const pending = deferred<void>();
  save.mockReturnValueOnce(pending.promise);
  const signingIn = controller.set(session);
  await Promise.resolve();
  const signingOut = controller.set(null);
  pending.resolve();
  await Promise.all([signingIn, signingOut]);
  expect(clear.mock.invocationCallOrder[0]).toBeGreaterThan(save.mock.invocationCallOrder[0]);
  await expect(controller.request('/me')).rejects.toThrow('Session changed');
});

it('does not keep using credentials when Keychain persistence fails', async () => {
  const { controller, save, onChange } = setup();
  save.mockRejectedValueOnce(new Error('Keychain unavailable'));
  await expect(controller.set(session)).rejects.toThrow('Keychain unavailable');
  expect(onChange).toHaveBeenLastCalledWith(null);
  await expect(controller.request('/me')).rejects.toThrow('Session changed');
});


it('times out a stalled refresh, aborts its transport, and allows a fresh retry', async () => {
  jest.useFakeTimers();
  try {
    const { controller, refresh, save, clear } = setup();
    const pending = deferred<StoredSession>();
    refresh.mockReturnValueOnce(pending.promise);
    await controller.set({ ...session, expiresAt: 0 });
    const assertion = expect(controller.request('/me')).rejects.toThrow('Session refresh timed out');
    await jest.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(refresh.mock.calls[0][1]?.aborted).toBe(true);
    expect(clear).not.toHaveBeenCalled();
    await expect(controller.request('/me')).resolves.toEqual({ ok: true });
    pending.resolve({ ...rotated, accessToken: 'late' });
    await Promise.resolve();
    expect(save).toHaveBeenLastCalledWith(rotated);
  } finally {
    jest.useRealTimers();
  }
});

it('cancels one refresh waiter without interrupting another request', async () => {
  const { controller, refresh, request } = setup();
  const pending = deferred<StoredSession>();
  refresh.mockReturnValueOnce(pending.promise);
  await controller.set({ ...session, expiresAt: 0 });
  const abort = new AbortController();
  const first = controller.request('/cancelled', { signal: abort.signal });
  const second = controller.request('/me');
  const assertion = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort();
  await assertion;
  expect(refresh.mock.calls[0][1]?.aborted).toBe(false);
  pending.resolve(rotated);
  await expect(second).resolves.toEqual({ ok: true });
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/me']);
});
