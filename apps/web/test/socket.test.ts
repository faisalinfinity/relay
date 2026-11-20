import type { ClientMessage, ServerMessage } from '@relay/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSocket, type LinkState, type SocketLike } from '../src/live/socket';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: ClientMessage[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  close() {
    this.closed = true;
  }
  // test controls
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

let sockets: FakeSocket[];
let states: LinkState[];
let lastSeq: number | null;
let live: LiveSocket;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  sockets = [];
  states = [];
  lastSeq = null;
  live = new LiveSocket({
    url: 'ws://relay.test/ws',
    agentId: 'agent-1',
    lastSeq: () => lastSeq,
    onMessage: () => undefined,
    onState: (state) => states.push(state),
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  live.start();
});

afterEach(() => {
  live.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const current = () => sockets.at(-1)!;

function goLive(seq = 10) {
  current().open();
  current().receive({ type: 'ready', mode: 'resumed', seq });
}

describe('LiveSocket', () => {
  it('says hello with the last seq it applied', () => {
    lastSeq = 42;
    current().open();
    expect(current().sent[0]).toEqual({ type: 'hello', agentId: 'agent-1', since: 42 });
    expect(states.at(-1)).toBe('catching-up');
  });

  it('goes live on ready and sends presence only from then on', () => {
    current().open();
    live.setViewing('ticket-1'); // too early: not sent, but remembered
    expect(current().sent.map((m) => m.type)).toEqual(['hello']);

    current().receive({ type: 'ready', mode: 'snapshot', seq: 0 });

    expect(states.at(-1)).toBe('live');
    expect(current().sent.at(-1)).toEqual({ type: 'viewing', ticketId: 'ticket-1' });
  });

  it('reconnects with backoff after a drop and re-sends what it was viewing', () => {
    goLive();
    live.setViewing('ticket-1');
    current().drop();
    expect(states.at(-1)).toBe('offline');
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(400); // first retry after ~375ms with jitter fixed at 0.5
    expect(sockets).toHaveLength(2);

    lastSeq = 57;
    goLive(57);
    expect(current().sent).toEqual([
      { type: 'hello', agentId: 'agent-1', since: 57 },
      { type: 'viewing', ticketId: 'ticket-1' },
    ]);
  });

  it('backs off further after each failed attempt', () => {
    current().drop();
    vi.advanceTimersByTime(400);
    expect(sockets).toHaveLength(2);
    current().drop();
    vi.advanceTimersByTime(400);
    expect(sockets).toHaveLength(2); // second wait is ~750ms
    vi.advanceTimersByTime(400);
    expect(sockets).toHaveLength(3);
  });

  it('reconnects at once when the laptop wakes from sleep', () => {
    goLive();
    // Timers freeze while asleep: ten minutes pass between two watchdog ticks
    vi.setSystemTime(Date.now() + 10 * 60_000);
    vi.advanceTimersByTime(5_000);

    expect(sockets).toHaveLength(2);
    expect(sockets[0]!.closed).toBe(true);
  });

  it('reconnects when the server goes silent, even though the socket looks open', () => {
    goLive();
    vi.advanceTimersByTime(35_000);
    expect(sockets).toHaveLength(1); // heartbeats are due every 15s; not dead yet
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(2);
  });

  it('stays connected while heartbeats keep arriving', () => {
    goLive();
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(15_000);
      current().receive({ type: 'heartbeat' });
    }
    expect(sockets).toHaveLength(1);
  });

  it('gives up when the server rejects the agent', () => {
    current().open();
    current().drop(4003);
    vi.advanceTimersByTime(60_000);
    expect(states.at(-1)).toBe('rejected');
    expect(sockets).toHaveLength(1);
  });
});
