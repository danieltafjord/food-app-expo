/* eslint-disable import/first -- jest.mock must precede the imports it stubs */
jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
}));
jest.mock('@/lib/store/persistence', () => ({ whenHydrated: Promise.resolve() }));
jest.mock('@/lib/sync/engine', () => ({
  handleRemoteVersion: jest.fn(),
  setPeersPresent: jest.fn(),
  setRealtimeLink: jest.fn(),
}));

import { FakeWebSocket } from '../../../jest/fake-websocket';

import { store$ } from '@/lib/store/collections';
import { setSyncAuth } from '@/lib/sync/auth-bridge';
import { handleRemoteVersion, setPeersPresent, setRealtimeLink } from '@/lib/sync/engine';

import { __resetRealtimeForTests, joinPresence, listScope, presence$, startRealtime } from './live';

const config = { key: 'app-key', host: 'ws.example.test', port: 443, scheme: 'https' };

function server(realtime: unknown = config) {
  const calls: { path: string; body?: any }[] = [];
  setSyncAuth(async <T,>(path: string, options: any = {}): Promise<T> => {
    calls.push({ path, body: options.body });
    if (path === '/realtime') return realtime as T;
    const channel: string = options.body.channel_name;
    return { auth: 'sig', ...(channel.startsWith('presence-') ? { channel_data: '{"user_id":"1","user_info":{"id":1,"name":"Me"}}' } : {}) } as T;
  });
  return calls;
}

async function live(): Promise<FakeWebSocket> {
  await startRealtime();
  const ws = FakeWebSocket.latest();
  ws.establish('9.9');
  await jest.advanceTimersByTimeAsync(0);
  return ws;
}

const members = (...list: [string, string][]) => ({
  presence: { ids: list.map(([id]) => id), hash: Object.fromEntries(list.map(([id, name]) => [id, { id: Number(id), name }])), count: list.length },
});

beforeAll(() => {
  (globalThis as any).WebSocket = FakeWebSocket;
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  FakeWebSocket.instances = [];
  store$.meta.serverHouseholdId.set(7);
});

afterEach(() => {
  __resetRealtimeForTests();
  setSyncAuth(null);
  jest.useRealTimers();
});

it('stays on polling when the server has no live sync', async () => {
  server(null);
  await startRealtime();
  expect(FakeWebSocket.instances).toHaveLength(0);
});

it('asks for the socket config again when the first ask fails', async () => {
  const calls = server();
  let fail = true;
  const answer = config;
  setSyncAuth(async <T,>(path: string): Promise<T> => {
    calls.push({ path });
    if (fail) throw new Error('offline');
    return (path === '/realtime' ? answer : { auth: 'sig' }) as T;
  });
  await startRealtime();
  expect(FakeWebSocket.instances).toHaveLength(0);

  fail = false;
  await jest.advanceTimersByTimeAsync(60_000);
  expect(FakeWebSocket.instances).toHaveLength(1);
});

it('listens to the household and pulls when the doorbell rings', async () => {
  server();
  const ws = await live();
  expect(ws.events('pusher:subscribe')).toEqual([{ channel: 'private-household.7', auth: 'sig' }]);

  ws.receive('pusher_internal:subscription_succeeded', {}, 'private-household.7');
  expect(setRealtimeLink).toHaveBeenLastCalledWith(true, '9.9');

  ws.receive('synced', { version: 42 }, 'private-household.7');
  expect(handleRemoteVersion).toHaveBeenCalledWith(42);

  ws.drop();
  expect(setRealtimeLink).toHaveBeenLastCalledWith(false, null);
});

it('stops and tells the session when this account is removed from the household', async () => {
  server();
  const onRemovedFromHousehold = jest.fn();
  await startRealtime({ userId: 1, onRemovedFromHousehold });
  const ws = FakeWebSocket.latest();
  ws.establish('9.9');
  await jest.advanceTimersByTimeAsync(0);
  ws.receive('pusher_internal:subscription_succeeded', {}, 'private-household.7');

  ws.receive('household.member-removed', { user_id: 2 }, 'private-household.7');
  expect(onRemovedFromHousehold).not.toHaveBeenCalled();

  ws.receive('household.member-removed', { user_id: 1 }, 'private-household.7');
  expect(onRemovedFromHousehold).toHaveBeenCalledTimes(1);
  expect(setRealtimeLink).toHaveBeenLastCalledWith(false, null);
});

it('follows the device to another household', async () => {
  server();
  const ws = await live();
  store$.meta.serverHouseholdId.set(8);
  await jest.advanceTimersByTimeAsync(0);
  expect(ws.events('pusher:unsubscribe')).toEqual([{ channel: 'private-household.7' }]);
  expect(ws.events('pusher:subscribe').map((m) => m.channel)).toContain('private-household.8');
});

it('lists everyone else in a scope, keeps it current, and leaves after lingering', async () => {
  server();
  const ws = await live();
  const channel = 'presence-household.7.list.abc';
  const handle = joinPresence(listScope('abc'));
  await jest.advanceTimersByTimeAsync(0);
  expect(ws.events('pusher:subscribe').map((m) => m.channel)).toContain(channel);

  ws.receive('pusher_internal:subscription_succeeded', members(['1', 'Me'], ['2', 'Ola Nordmann']), channel);
  expect(presence$[listScope('abc')].get()).toEqual([{ id: 2, name: 'Ola Nordmann' }]);
  expect(setPeersPresent).toHaveBeenLastCalledWith(true);

  ws.receive('pusher_internal:member_added', { user_id: '3', user_info: { id: 3, name: 'Anna' } }, channel);
  expect(presence$[listScope('abc')].get()?.map((m) => m.name)).toEqual(['Anna', 'Ola Nordmann']);

  ws.receive('pusher_internal:member_removed', { user_id: '2' }, channel);
  ws.receive('pusher_internal:member_removed', { user_id: '3' }, channel);
  expect(presence$[listScope('abc')].get()).toEqual([]);
  expect(setPeersPresent).toHaveBeenLastCalledWith(false);

  handle.release(1500);
  await jest.advanceTimersByTimeAsync(1000);
  expect(ws.events('pusher:unsubscribe')).toEqual([]);
  await jest.advanceTimersByTimeAsync(600);
  expect(ws.events('pusher:unsubscribe')).toEqual([{ channel }]);
  expect(presence$[listScope('abc')].get()).toBeUndefined();
});

it('shares a scope between holders and rejoins within the linger without resubscribing', async () => {
  server();
  const ws = await live();
  const first = joinPresence(listScope('abc'));
  const second = joinPresence(listScope('abc'));
  await jest.advanceTimersByTimeAsync(0);
  first.release();
  second.release(1500);
  const again = joinPresence(listScope('abc'));
  await jest.advanceTimersByTimeAsync(5000);
  expect(ws.events('pusher:subscribe').filter((m) => m.channel.startsWith('presence-'))).toHaveLength(1);
  expect(ws.events('pusher:unsubscribe')).toEqual([]);
  again.release();
  expect(ws.events('pusher:unsubscribe')).toHaveLength(1);
});

it('joins scopes opened before the socket came up', async () => {
  server();
  const handle = joinPresence(listScope('abc'));
  const ws = await live();
  expect(ws.events('pusher:subscribe').map((m) => m.channel)).toContain('presence-household.7.list.abc');
  handle.release();
});
