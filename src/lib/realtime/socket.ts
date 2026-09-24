/**
 * A small client for the Pusher channel protocol (v7), which Laravel Reverb
 * speaks. Only what live sync needs: one connection, private and presence
 * channels authorized through the API, keep-alive pings and reconnects.
 *
 * Hand-rolled rather than `pusher-js`: its React Native build needs a native
 * module (NetInfo), which would force a new binary instead of an OTA update,
 * and this protocol subset is small.
 */

export type SocketConfig = { key: string; host: string; port: number; scheme: string };

/** What the server's `/broadcasting/auth` returns for a channel. */
export type ChannelAuth = { auth: string; channel_data?: string };

export type Authorizer = (socketId: string, channel: string) => Promise<ChannelAuth>;

/**
 * A message for one channel. Protocol events keep their names:
 * `pusher_internal:subscription_succeeded`, `pusher_internal:member_added`,
 * `pusher_internal:member_removed`, `pusher:subscription_error`. The event
 * `subscription_failed` is ours: authorizing the channel failed.
 */
export type ChannelMessage = { event: string; data: any };

export type SocketState = 'idle' | 'connecting' | 'connected';

type Listener = (message: ChannelMessage) => void;

type Options = {
  config: SocketConfig;
  authorize: Authorizer;
  onStateChange?: (state: SocketState) => void;
  /** For tests. */
  createSocket?: (url: string) => WebSocket;
};

const PROTOCOL = 7;
/** Ping after this long without traffic, unless the server asks for sooner. */
const DEFAULT_ACTIVITY_MS = 120_000;
/** A ping without a pong in this long means the connection is dead. */
const PONG_TIMEOUT_MS = 15_000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

export function socketUrl({ key, host, port, scheme }: SocketConfig): string {
  const secure = scheme === 'https';
  return `${secure ? 'wss' : 'ws'}://${host}:${port}/app/${encodeURIComponent(key)}?protocol=${PROTOCOL}&client=js&version=8.4.0&flash=false`;
}

function parse(value: unknown): any {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export class PusherSocket {
  private ws: WebSocket | null = null;
  private state: SocketState = 'idle';
  private wanted = false;
  private id: string | null = null;
  /** Bumped on every new connection, so a late auth answer for an old one is dropped. */
  private generation = 0;
  private readonly channels = new Map<string, Listener>();
  private activityMs = DEFAULT_ACTIVITY_MS;
  private activityTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;

  constructor(private readonly options: Options) {}

  /** The server's id for this connection; null until connected. */
  get socketId(): string | null {
    return this.id;
  }

  get connected(): boolean {
    return this.state === 'connected';
  }

  connect(): void {
    this.wanted = true;
    if (this.ws || this.reconnectTimer) return;
    this.open();
  }

  /** Close for good (until `connect()`). Channels are kept and resubscribed then. */
  disconnect(): void {
    this.wanted = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempts = 0;
    this.close();
  }

  /** Listen to a channel; subscribes now if connected, else on connect. Returns an unsubscribe. */
  subscribe(channel: string, listener: Listener): () => void {
    this.channels.set(channel, listener);
    if (this.connected) void this.join(channel, this.generation);
    return () => {
      if (this.channels.get(channel) !== listener) return;
      this.channels.delete(channel);
      if (this.connected) this.send('pusher:unsubscribe', { channel });
    };
  }

  private open(): void {
    const generation = ++this.generation;
    this.setState('connecting');
    const url = socketUrl(this.options.config);
    const ws = this.options.createSocket ? this.options.createSocket(url) : new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (event) => {
      if (generation === this.generation) this.receive(String(event.data));
    };
    ws.onclose = (event) => {
      if (generation === this.generation) this.closed(event.code);
    };
    // Errors are followed by a close, which does the bookkeeping.
    ws.onerror = () => undefined;
  }

  private close(): void {
    this.generation += 1;
    this.clearKeepAlive();
    const ws = this.ws;
    this.ws = null;
    this.id = null;
    if (ws) {
      ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        // Already closing.
      }
    }
    this.setState('idle');
  }

  private closed(code: number): void {
    this.close();
    if (!this.wanted) return;
    // 4000–4099: the server refuses this app or connection; retrying won't help.
    if (code >= 4000 && code < 4100) {
      this.wanted = false;
      return;
    }
    const immediate = code >= 4200 && code < 4300;
    const backoff = immediate ? 0 : Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wanted) this.open();
    }, backoff + backoff * 0.3 * Math.random());
  }

  private receive(raw: string): void {
    const message = parse(raw) as { event?: string; channel?: string; data?: unknown } | null;
    if (!message || typeof message.event !== 'string') return;
    this.armKeepAlive();
    const data = parse(message.data);

    switch (message.event) {
      case 'pusher:connection_established':
        this.id = typeof data?.socket_id === 'string' ? data.socket_id : null;
        if (typeof data?.activity_timeout === 'number' && data.activity_timeout > 0) {
          this.activityMs = Math.min(DEFAULT_ACTIVITY_MS, data.activity_timeout * 1000);
        }
        this.attempts = 0;
        this.setState('connected');
        for (const channel of this.channels.keys()) void this.join(channel, this.generation);
        return;
      case 'pusher:ping':
        this.send('pusher:pong', {});
        return;
      case 'pusher:pong':
        return;
      case 'pusher:error':
        return;
    }

    if (typeof message.channel === 'string') {
      this.channels.get(message.channel)?.({ event: message.event, data });
    }
  }

  private async join(channel: string, generation: number): Promise<void> {
    const socketId = this.id;
    if (!socketId) return;
    let auth: ChannelAuth | null = null;
    if (channel.startsWith('private-') || channel.startsWith('presence-')) {
      try {
        auth = await this.options.authorize(socketId, channel);
      } catch (error) {
        if (generation === this.generation) this.channels.get(channel)?.({ event: 'subscription_failed', data: error });
        return;
      }
    }
    // The connection or the subscription may have gone while authorizing.
    if (generation !== this.generation || !this.channels.has(channel)) return;
    this.send('pusher:subscribe', { channel, ...(auth ?? {}) });
  }

  private send(event: string, data: unknown): void {
    try {
      this.ws?.send(JSON.stringify({ event, data }));
    } catch {
      // A socket that can't send is about to close.
    }
  }

  /** Any traffic proves the link; after a quiet spell, ping and expect a pong. */
  private armKeepAlive(): void {
    this.clearKeepAlive();
    this.activityTimer = setTimeout(() => {
      this.send('pusher:ping', {});
      this.pongTimer = setTimeout(() => this.closed(4201), PONG_TIMEOUT_MS);
    }, this.activityMs);
  }

  private clearKeepAlive(): void {
    if (this.activityTimer) clearTimeout(this.activityTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.activityTimer = this.pongTimer = null;
  }

  private setState(state: SocketState): void {
    if (state === this.state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }
}
