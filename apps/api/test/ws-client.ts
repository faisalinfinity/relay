import type { ClientMessage, ServerMessage } from '@relay/shared';
import WebSocket from 'ws';

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

/**
 * A WebSocket client for tests. `next()` returns the next message of a type, in arrival order:
 * each call continues after the message the previous call returned.
 */
export class TestSocket {
  readonly received: ServerMessage[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private cursor = 0;
  private wake: () => void = () => undefined;

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data: Buffer) => {
      this.received.push(JSON.parse(data.toString('utf8')) as ServerMessage);
      this.wake();
    });
    this.closed = new Promise((resolve) => {
      ws.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
        this.wake();
      });
    });
  }

  static async open(url: string): Promise<TestSocket> {
    const ws = new WebSocket(url);
    const socket = new TestSocket(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return socket;
  }

  send(message: ClientMessage) {
    this.ws.send(JSON.stringify(message));
  }

  async next<T extends ServerMessage['type']>(
    type: T,
    matches: (message: Of<T>) => boolean = () => true,
    timeoutMs = 3_000,
  ): Promise<Of<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let i = this.cursor; i < this.received.length; i++) {
        const message = this.received[i]!;
        if (message.type === type && matches(message as Of<T>)) {
          this.cursor = i + 1;
          return message as Of<T>;
        }
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `no "${type}" message within ${timeoutMs}ms; got ${JSON.stringify(this.received)}`,
        );
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  /** Events received since the last call to next() returned. */
  eventsAfterCursor() {
    return this.received
      .slice(this.cursor)
      .filter((message): message is Of<'event'> => message.type === 'event')
      .map((message) => message.event);
  }

  close() {
    this.ws.close();
    return this.closed;
  }
}
