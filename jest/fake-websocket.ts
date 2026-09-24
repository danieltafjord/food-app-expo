/** A scriptable WebSocket for the live-sync tests: records what the app sends, lets the test play the server. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static latest(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  sent: { event: string; data: any }[] = [];
  closed = false;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }

  close(): void {
    this.closed = true;
  }

  /** The server sends a protocol message; `data` is JSON-encoded like Reverb does. */
  receive(event: string, data: unknown = {}, channel?: string): void {
    this.onmessage?.({ data: JSON.stringify({ event, ...(channel ? { channel } : {}), data: JSON.stringify(data) }) });
  }

  establish(socketId = '1.1', activityTimeout = 30): void {
    this.receive('pusher:connection_established', { socket_id: socketId, activity_timeout: activityTimeout });
  }

  /** The server drops the connection. */
  drop(code = 1006): void {
    this.onclose?.({ code });
  }

  events(name: string): any[] {
    return this.sent.filter((message) => message.event === name).map((message) => message.data);
  }
}
