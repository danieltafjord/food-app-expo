import { observable } from '@legendapp/state';
import { AppState, type NativeEventSubscription } from 'react-native';

import { store$ } from '@/lib/store/collections';
import { getSyncRequest } from '@/lib/sync/auth-bridge';
import { handleRemoteVersion, setPeersPresent, setRealtimeLink } from '@/lib/sync/engine';

import { PusherSocket, type ChannelAuth, type ChannelMessage, type SocketConfig } from './socket';

/**
 * Live sync over Laravel Reverb.
 *
 * Two things ride on one socket:
 *  - `private-household.{id}`: a doorbell the server rings after every
 *    committed write, carrying only the new version. The sync engine pulls
 *    through the normal endpoint, so conflicts and tombstones stay in one place.
 *  - `presence-household.{id}.{scope}`: who else has a shopping list
 *    (`list.{uuid}`) or a week of the plan (`week.{monday}`) open right now.
 *
 * Everything is optional: with no socket (server without Reverb, offline,
 * backgrounded) the engine keeps polling and presence is simply empty.
 */

export type PresenceMember = { id: number; name: string };

/** Everyone else with a scope open, by scope. Only scopes this device has joined. */
export const presence$ = observable<Record<string, PresenceMember[]>>({});

type Room = {
  refs: number;
  leaveTimer: ReturnType<typeof setTimeout> | null;
  unsubscribe: (() => void) | null;
  members: Map<string, PresenceMember>;
};

let running = false;
let generation = 0;
let socket: PusherSocket | null = null;
let householdId: number | null = null;
let unsubscribeHousehold: (() => void) | null = null;
let disposeHouseholdWatch: (() => void) | null = null;
let appStateSub: NativeEventSubscription | null = null;
/** Our own presence id (a string, as the protocol sends it), learned from channel auth. */
let myId: string | null = null;
const rooms = new Map<string, Room>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** How long to wait before asking for the socket config again after a failed ask. */
const CONFIG_RETRY_MS = 60_000;

/* ---- lifecycle ----------------------------------------------------------- */

/** Open live sync for the signed-in account. Safe to call repeatedly. */
export async function startRealtime(): Promise<void> {
  if (running) return;
  running = true;
  const current = ++generation;
  const request = getSyncRequest();
  if (!request) {
    running = false;
    return;
  }

  let config: SocketConfig | null = null;
  try {
    config = await request<SocketConfig | null>('/realtime');
  } catch {
    // Offline, or an older server: poll meanwhile and ask again later.
    if (current !== generation) return;
    running = false;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (current === generation) void startRealtime();
    }, CONFIG_RETRY_MS);
    return;
  }
  // No config: this server has live sync off. Keep polling.
  if (current !== generation || !config?.key || !config.host) return;

  socket = new PusherSocket({ config, authorize, onStateChange: handleStateChange });
  disposeHouseholdWatch = store$.meta.serverHouseholdId.onChange(bindHousehold);
  bindHousehold();
  // iOS drops a backgrounded app's sockets anyway; closing ours tells peers we left.
  appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') socket?.connect();
    else if (state === 'background') socket?.disconnect();
  });
  if (AppState.currentState !== 'background') socket.connect();
}

/** Close live sync (sign-out). Screens keep their presence handles; they rejoin on the next start. */
export function stopRealtime(): void {
  generation += 1;
  running = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  appStateSub?.remove();
  appStateSub = null;
  disposeHouseholdWatch?.();
  disposeHouseholdWatch = null;
  unsubscribeHousehold = null;
  for (const room of rooms.values()) {
    room.unsubscribe = null;
    room.members.clear();
  }
  socket?.disconnect();
  socket = null;
  householdId = null;
  myId = null;
  presence$.set({});
  setPeersPresent(false);
  setRealtimeLink(false, null);
}

/** Test-only: forget all module state. */
export function __resetRealtimeForTests(): void {
  stopRealtime();
  for (const room of rooms.values()) if (room.leaveTimer) clearTimeout(room.leaveTimer);
  rooms.clear();
}

async function authorize(socketId: string, channel: string): Promise<ChannelAuth> {
  const request = getSyncRequest();
  if (!request) throw new Error('Signed out');
  const auth = await request<ChannelAuth>('/broadcasting/auth', {
    method: 'POST',
    body: { socket_id: socketId, channel_name: channel },
  });
  if (auth.channel_data) {
    try {
      const userId = JSON.parse(auth.channel_data)?.user_id;
      if (userId != null) myId = String(userId);
    } catch {
      // Presence still works; we'd only list ourselves too.
    }
  }
  return auth;
}

function handleStateChange(): void {
  if (socket?.connected) return;
  // Dropped: the doorbell is gone until resubscribed, and member lists are
  // stale (the server resends them on resubscribe).
  setRealtimeLink(false, null);
  for (const room of rooms.values()) room.members.clear();
  presence$.set({});
  setPeersPresent(false);
}

/** (Re)subscribe everything under the household this device is bound to. */
function bindHousehold(): void {
  const id = store$.meta.serverHouseholdId.peek() ?? null;
  if (!socket || id === householdId) return;
  unsubscribeHousehold?.();
  unsubscribeHousehold = null;
  setRealtimeLink(false, null);
  householdId = id;
  if (id !== null) {
    unsubscribeHousehold = socket.subscribe(`private-household.${id}`, onHouseholdMessage);
  }
  for (const [scope, room] of rooms) subscribeRoom(scope, room);
}

function onHouseholdMessage({ event, data }: ChannelMessage): void {
  if (event === 'pusher_internal:subscription_succeeded') {
    setRealtimeLink(true, socket?.socketId ?? null);
  } else if (event === 'synced') {
    handleRemoteVersion(Number(data?.version));
  }
}

/* ---- presence ------------------------------------------------------------ */

/** Presence scope for a shopping list. */
export const listScope = (listId: string) => `list.${listId}`;

/** Presence scope for a week of the plan, keyed by its first day (`YYYY-MM-DD`). */
export const weekScope = (weekStart: string) => `week.${weekStart}`;

export type PresenceHandle = { release: (delayMs?: number) => void };

/** Whether this device has `scope` open on a focused screen right now. */
export function isInPresenceScope(scope: string): boolean {
  return (rooms.get(scope)?.refs ?? 0) > 0;
}

/**
 * Show this user in a scope until released. Ref-counted, so a screen and a
 * sheet over it can both hold the same scope; `release(delay)` lingers so a
 * quick hop away and back doesn't flicker for everyone else.
 */
export function joinPresence(scope: string): PresenceHandle {
  let room = rooms.get(scope);
  if (!room) {
    room = { refs: 0, leaveTimer: null, unsubscribe: null, members: new Map() };
    rooms.set(scope, room);
  }
  const joined = room;
  joined.refs += 1;
  if (joined.leaveTimer) {
    clearTimeout(joined.leaveTimer);
    joined.leaveTimer = null;
  }
  if (!joined.unsubscribe) subscribeRoom(scope, joined);

  let released = false;
  return {
    release(delayMs = 0) {
      if (released) return;
      released = true;
      joined.refs -= 1;
      if (joined.refs > 0) return;
      const leave = () => {
        joined.leaveTimer = null;
        if (joined.refs > 0 || rooms.get(scope) !== joined) return;
        joined.unsubscribe?.();
        rooms.delete(scope);
        presence$[scope].delete();
        updatePeers();
      };
      if (delayMs > 0) joined.leaveTimer = setTimeout(leave, delayMs);
      else leave();
    },
  };
}

function subscribeRoom(scope: string, room: Room): void {
  room.unsubscribe?.();
  room.unsubscribe = null;
  room.members.clear();
  publish(scope, room);
  if (!socket || householdId === null) return;
  room.unsubscribe = socket.subscribe(`presence-household.${householdId}.${scope}`, (message) =>
    onRoomMessage(scope, room, message),
  );
}

function onRoomMessage(scope: string, room: Room, { event, data }: ChannelMessage): void {
  if (event === 'pusher_internal:subscription_succeeded') {
    room.members.clear();
    const hash: Record<string, { name?: unknown }> = data?.presence?.hash ?? {};
    for (const [id, info] of Object.entries(hash)) room.members.set(id, member(id, info));
  } else if (event === 'pusher_internal:member_added' && data?.user_id != null) {
    room.members.set(String(data.user_id), member(String(data.user_id), data.user_info));
  } else if (event === 'pusher_internal:member_removed' && data?.user_id != null) {
    room.members.delete(String(data.user_id));
  } else {
    return;
  }
  publish(scope, room);
}

function member(id: string, info: { name?: unknown } | undefined): PresenceMember {
  return { id: Number(id), name: typeof info?.name === 'string' ? info.name : '' };
}

function publish(scope: string, room: Room): void {
  if (rooms.get(scope) !== room) return;
  const others = [...room.members.entries()]
    .filter(([id]) => id !== myId)
    .map(([, m]) => m)
    .sort((a, b) => a.name.localeCompare(b.name));
  const previous = presence$[scope].peek();
  const same = previous?.length === others.length && previous.every((m, i) => m.id === others[i].id && m.name === others[i].name);
  if (!same) presence$[scope].set(others);
  updatePeers();
}

function updatePeers(): void {
  setPeersPresent(Object.values(presence$.peek() ?? {}).some((others) => others.length > 0));
}
