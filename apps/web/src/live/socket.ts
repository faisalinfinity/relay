import type { ClientMessage, ServerMessage } from '@relay/shared';
import { CLOSE_CODES } from '@relay/shared';

/**
 * connecting: opening a socket, before it has ever been live
 * catching-up: socket open, hello sent, waiting for the server's "ready"
 * live: caught up, events flowing
 * offline: no socket, a reconnect is scheduled
 * rejected: the server refused this agent; reconnecting would not help
 */
export type LinkState = 'connecting' | 'catching-up' | 'live' | 'offline' | 'rejected';

/** The subset of the browser WebSocket this class uses, so tests can pass a fake. */
export interface SocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface LiveSocketOptions {
  url: string;
  agentId: string;
  /** the last event seq this browser applied; sent with every hello */
  lastSeq: () => number | null;
  onMessage: (message: ServerMessage) => void;
  onState: (state: LinkState) => void;
  createSocket?: (url: string) => SocketLike;
}

const OPEN = 1;
const WATCHDOG_MS = 5_000;
/** The watchdog fired this much later than scheduled: the machine was asleep. */
const SLEEP_GAP_MS = 15_000;
/** The server sends a heartbeat every 15s, so this much silence means the link is dead. */
const SILENCE_LIMIT_MS = 40_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * One WebSocket to the Relay API that keeps itself connected.
 *
 * On every (re)connect it says hello with the last seq it applied, so the server can replay
 * exactly what this tab missed. It reconnects with jittered exponential backoff, and immediately
 * when the network comes back or the laptop wakes up.
 */
export class LiveSocket {
  private ws: SocketLike | null = null;
  private state: LinkState = 'connecting';
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private lastTick = Date.now();
  private lastMessageAt = Date.now();
  private viewing: string | null = null;
  private stopped = false;

  constructor(private readonly options: LiveSocketOptions) {}

  start() {
    this.connect();
    this.watchdog = setInterval(() => this.checkHealth(), WATCHDOG_MS);
    globalThis.addEventListener?.('online', this.reconnectNow);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.watchdog);
    clearTimeout(this.reconnectTimer);
    globalThis.removeEventListener?.('online', this.reconnectNow);
    this.drop();
  }

  /** Remembered, and sent again after every reconnect: the server forgets presence on disconnect. */
  setViewing(ticketId: string | null) {
    this.viewing = ticketId;
    this.send({ type: 'viewing', ticketId });
  }

  setTyping(ticketId: string, typing: boolean) {
    this.send({ type: 'typing', ticketId, typing });
  }

  /** Drop the current socket and connect straight away. */
  reconnectNow = () => {
    if (this.stopped || this.state === 'rejected') return;
    clearTimeout(this.reconnectTimer);
    this.attempt = 0;
    this.drop();
    this.connect();
  };

  private connect() {
    const create = this.options.createSocket ?? ((url: string) => new WebSocket(url) as SocketLike);
    const ws = create(this.options.url);
    this.ws = ws;
    this.lastMessageAt = Date.now();
    if (this.state !== 'offline') this.setState('connecting');

    ws.onopen = () => {
      this.setState('catching-up');
      this.sendNow(ws, {
        type: 'hello',
        agentId: this.options.agentId,
        since: this.options.lastSeq(),
      });
    };
    ws.onmessage = (event) => {
      this.lastMessageAt = Date.now();
      const message = JSON.parse(String(event.data)) as ServerMessage;
      this.options.onMessage(message);
      if (message.type === 'ready') {
        this.attempt = 0;
        this.setState('live');
        if (this.viewing) this.sendNow(ws, { type: 'viewing', ticketId: this.viewing });
      }
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return; // an old socket we already replaced
      this.ws = null;
      if (event.code === CLOSE_CODES.UNKNOWN_AGENT) {
        this.setState('rejected');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.setState('offline');
    // Jitter spreads reconnects out, so a server restart doesn't get every browser at once
    const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt);
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /**
   * Runs every 5 seconds. A connection can be dead without the browser noticing:
   * - the laptop slept: timers were frozen, so this tick arrives far later than scheduled;
   * - the network dropped silently: no heartbeat from the server for 40 seconds.
   * Either way, reconnect now instead of waiting for TCP to give up, which can take minutes.
   */
  private checkHealth() {
    const now = Date.now();
    const slept = now - this.lastTick > WATCHDOG_MS + SLEEP_GAP_MS;
    this.lastTick = now;
    const silent = this.ws?.readyState === OPEN && now - this.lastMessageAt > SILENCE_LIMIT_MS;
    if (slept || silent) this.reconnectNow();
  }

  private drop() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = null;
    ws.close();
  }

  private send(message: ClientMessage) {
    // Before "ready" the server isn't listening for these; viewing is re-sent on ready anyway
    if (this.ws && this.state === 'live') this.sendNow(this.ws, message);
  }

  private sendNow(ws: SocketLike, message: ClientMessage) {
    if (ws.readyState === OPEN) ws.send(JSON.stringify(message));
  }

  private setState(state: LinkState) {
    if (this.state === state) return;
    this.state = state;
    this.options.onState(state);
  }
}
