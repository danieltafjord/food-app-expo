import { deferHouseholdSetup, setupAccount } from './account-setup';

const household = { id: 7, name: 'My Kitchen', default_servings: 4 };
const me = { id: 1, current_household: null };
const options = () => ({ defer: false, name: 'My Kitchen', defaultServings: 4, signal: new AbortController().signal });

it('creates the first household with the local servings and returns it for sync', async () => {
  const request = jest.fn().mockResolvedValueOnce(me).mockResolvedValueOnce(household);
  const result = await setupAccount(request, options());
  expect(result.current_household).toEqual(household);
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/me', '/household/setup']);
  expect(request.mock.calls[1][1]).toMatchObject({
    method: 'POST', body: { name: 'My Kitchen', default_servings: 4 },
  });
});

it('reuses the active household without provisioning another', async () => {
  const request = jest.fn().mockResolvedValue({ ...me, current_household: household });
  expect((await setupAccount(request, options())).current_household).toEqual(household);
  expect(request).toHaveBeenCalledTimes(1);
});

it.each(['/sign-in', '/oauth/callback', '/invitations/invite-token'])(
  'does not provision while auth or invitation navigation is active: %s', async (pathname) => {
    const request = jest.fn().mockResolvedValue(me);
    const result = await setupAccount(request, { ...options(), defer: deferHouseholdSetup(pathname) });
    expect(result.current_household).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  },
);

it('sets up normally after leaving or declining an invitation', () => {
  expect(deferHouseholdSetup('/account')).toBe(false);
  expect(deferHouseholdSetup('/')).toBe(false);
});

it('surfaces setup failures and can recover if creation succeeded but its response was lost', async () => {
  const request = jest.fn().mockResolvedValueOnce(me).mockRejectedValueOnce(new Error('Offline'));
  await expect(setupAccount(request, options())).rejects.toThrow('Offline');
  request.mockResolvedValueOnce({ ...me, current_household: household });
  expect((await setupAccount(request, options())).current_household).toEqual(household);
  expect(request.mock.calls.filter(([path]) => path === '/household/setup')).toHaveLength(1);
});

it('does not provision after sign-out, navigation cancellation, or timeout during account loading', async () => {
  const abort = new AbortController();
  const request = jest.fn().mockImplementation(async () => {
    abort.abort();
    return me;
  });
  await expect(setupAccount(request, { ...options(), signal: abort.signal })).rejects.toThrow('Setup cancelled');
  expect(request).toHaveBeenCalledTimes(1);
});

it('does not publish a stale household after cancellation during creation', async () => {
  const abort = new AbortController();
  const request = jest.fn().mockResolvedValueOnce(me).mockImplementationOnce(async () => {
    abort.abort();
    return household;
  });
  await expect(setupAccount(request, { ...options(), signal: abort.signal })).rejects.toThrow('Setup cancelled');
});
