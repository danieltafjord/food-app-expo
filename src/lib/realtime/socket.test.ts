import { FakeWebSocket } from '../../../jest/fake-websocket';

import { PusherSocket, socketUrl, type ChannelAuth, type ChannelMessage } from './socket';

const config = { key: 'app-key', host: 'ws.example.test', port: 443, scheme: 'https' };

type AuthorizeMock = jest.Mock<Promise<ChannelAuth>, [string, string]>;

function makeSocket(authorize: AuthorizeMock = jest.fn(async (socketId: string, channel: string) => ({
  auth: `app-key:${socketId}:${channel}`,
  ...(channel.startsWith('presence-') ? { channel_data: '{"user_id":"1"}' } : {}),
}))) {
  const states: string[] = [];
  const socket = new PusherSocket({
    config,
    authorize,
    onStateChange: (state) => states.push(state),
    createSocket: (url) => new FakeWebSocket(url) as unknown as WebSocket,
  });
  return { socket, authorize, states };
}

beforeEach(() => {
  jest.useFakeTimers();
  FakeWebSocket.instances = [];
});

afterEach(() => {
  jest.useRealTimers();
});

it('speaks protocol 7 over TLS for https hosts', () => {
  expect(socketUrl(config)).toBe('wss://ws.example.test:443/app/app-key?protocol=7&client=js&version=8.4.0&flash=false');
  expect(socketUrl({ ...config, scheme: 'http', port: 8080 })).toMatch(/^ws:\/\/ws\.example\.test:8080\//);
});

it('authorizes and subscribes channels once connected, and routes their events', async () => {
  const { socket, authorize, states } = makeSocket();
  const messages: ChannelMessage[] = [];
  socket.subscribe('private-household.7', (message) => messages.push(message));
  socket.connect();
  const ws = FakeWebSocket.latest();
  expect(ws.sent).toEqual([]);

  ws.establish('123.456');
  await jest.advanceTimersByTimeAsync(0);
  expect(socket.socketId).toBe('123.456');
  expect(states).toEqual(['connecting', 'connected']);
  expect(authorize).toHaveBeenCalledWith('123.456', 'private-household.7');
  expect(ws.events('pusher:subscribe')).toEqual([{ channel: 'private-household.7', auth: 'app-key:123.456:private-household.7' }]);

  ws.receive('synced', { version: 9 }, 'private-household.7');
  ws.receive('synced', { version: 10 }, 'private-household.8');
  expect(messages).toEqual([{ event: 'synced', data: { version: 9 } }]);
});

it('sends presence channel data, and unsubscribes', async () => {
  const { socket } = makeSocket();
  socket.connect();
  const ws = FakeWebSocket.latest();
  ws.establish();
  const leave = socket.subscribe('presence-household.7.list.abc', () => undefined);
  await jest.advanceTimersByTimeAsync(0);
  expect(ws.events('pusher:subscribe')[0]).toMatchObject({ channel: 'presence-household.7.list.abc', channel_data: '{"user_id":"1"}' });

  leave();
  expect(ws.events('pusher:unsubscribe')).toEqual([{ channel: 'presence-household.7.list.abc' }]);
});

it('tells a channel when it could not be authorized', async () => {
  const { socket } = makeSocket(jest.fn<Promise<ChannelAuth>, [string, string]>(async () => {
    throw new Error('403');
  }));
  const messages: ChannelMessage[] = [];
  socket.subscribe('private-household.7', (message) => messages.push(message));
  socket.connect();
  FakeWebSocket.latest().establish();
  await jest.advanceTimersByTimeAsync(0);
  expect(messages.map((message) => message.event)).toEqual(['subscription_failed']);
  expect(FakeWebSocket.latest().events('pusher:subscribe')).toEqual([]);
});

it('answers pings, and pings a quiet connection, reconnecting when no pong comes', async () => {
  const { socket } = makeSocket();
  socket.connect();
  const ws = FakeWebSocket.latest();
  ws.establish('1.1', 30);
  ws.receive('pusher:ping');
  expect(ws.events('pusher:pong')).toHaveLength(1);

  await jest.advanceTimersByTimeAsync(30_000);
  expect(ws.events('pusher:ping')).toHaveLength(1);
  ws.receive('pusher:pong');
  await jest.advanceTimersByTimeAsync(20_000);
  expect(FakeWebSocket.instances).toHaveLength(1);

  // Quiet again, and this time the pong never comes.
  await jest.advanceTimersByTimeAsync(10_000 + 15_000);
  expect(ws.closed).toBe(true);
  await jest.advanceTimersByTimeAsync(10);
  expect(FakeWebSocket.instances).toHaveLength(2);
});

it('reconnects after a drop and resubscribes with fresh auth', async () => {
  const { socket, authorize } = makeSocket();
  socket.subscribe('private-household.7', () => undefined);
  socket.connect();
  FakeWebSocket.latest().establish('1.1');
  await jest.advanceTimersByTimeAsync(0);

  FakeWebSocket.latest().drop();
  expect(socket.connected).toBe(false);
  expect(socket.socketId).toBeNull();
  await jest.advanceTimersByTimeAsync(1_300);
  expect(FakeWebSocket.instances).toHaveLength(2);

  FakeWebSocket.latest().establish('2.2');
  await jest.advanceTimersByTimeAsync(0);
  expect(authorize).toHaveBeenLastCalledWith('2.2', 'private-household.7');
  expect(FakeWebSocket.latest().events('pusher:subscribe')).toHaveLength(1);
});

it('gives up when the server refuses the app, and stays down after disconnect()', async () => {
  const refused = makeSocket().socket;
  refused.connect();
  FakeWebSocket.latest().drop(4001);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(FakeWebSocket.instances).toHaveLength(1);

  FakeWebSocket.instances = [];
  const { socket } = makeSocket();
  socket.connect();
  const ws = FakeWebSocket.latest();
  ws.establish();
  socket.disconnect();
  expect(ws.closed).toBe(true);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(FakeWebSocket.instances).toHaveLength(1);
});

it('drops an authorization that finishes after its connection was replaced', async () => {
  let finish!: (auth: { auth: string }) => void;
  const { socket } = makeSocket(jest.fn<Promise<ChannelAuth>, [string, string]>(() => new Promise((resolve) => {
    finish = resolve;
  })));
  socket.subscribe('private-household.7', () => undefined);
  socket.connect();
  const first = FakeWebSocket.latest();
  first.establish('1.1');
  first.drop();
  finish({ auth: 'stale' });
  await jest.advanceTimersByTimeAsync(0);
  expect(first.events('pusher:subscribe')).toEqual([]);
});
