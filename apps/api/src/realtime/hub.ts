import type { Server } from 'node:http';
import {
  ClientMessage,
  CLOSE_CODES,
  type AgentRef,
  type ServerMessage,
  type TicketEvent,
  type Viewer,
} from '@relay/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { Db } from '../db/client';
import { agents } from '../db/schema';
import { eventRange, readEventsSince } from './events';
import type { EventRelay } from './relay';

export interface RealtimeOptions {
  /** how often to ping; a connection that misses one ping is dropped */
  heartbeatMs: number;
  /** "typing" clears itself if the browser stops refreshing it for this long */
  typingTimeoutMs: number;
  /** a connection must say hello within this time */
  helloTimeoutMs: number;
  /** a reconnect further behind than this refetches instead of replaying */
  maxReplay: number;
}

export interface HubDeps {
  db: Db;
  relay: EventRelay;
  logger: Logger;
  /** Reads the log for a reconnect's replay. Swappable so tests can commit events mid-replay. */
  readEvents?: typeof readEventsSince;
}

const DEFAULTS: RealtimeOptions = {
  heartbeatMs: 15_000,
  typingTimeoutMs: 6_000,
  helloTimeoutMs: 5_000,
  maxReplay: 1_000,
};

interface Connection {
  ws: WebSocket;
  /** null until the hello has been accepted */
  agent: AgentRef | null;
  /** While the connection is catching up, live events wait here so they can't overtake the replay */
  pending: TicketEvent[] | null;
  viewing: string | null;
  typing: boolean;
  typingTimer?: NodeJS.Timeout;
  alive: boolean;
  /** messages from one browser are handled one at a time, in order */
  inbox: Promise<void>;
}

/**
 * The WebSocket side of Relay, on /ws. It does three jobs:
 * 1. pushes every ticket event to every connected agent,
 * 2. brings a reconnecting browser up to date from the seq it last saw,
 * 3. tracks presence: who has which ticket open, and who is typing.
 *
 * Presence lives in this process's memory, so it is per API instance. DESIGN.md covers what
 * changes with several instances.
 */
export class RealtimeHub {
  private readonly options: RealtimeOptions;
  private readonly wss: WebSocketServer;
  private readonly connections = new Set<Connection>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly unsubscribe: () => void;

  constructor(
    server: Server,
    private readonly deps: HubDeps,
    options: Partial<RealtimeOptions> = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
    this.wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.unsubscribe = deps.relay.subscribe((event) => this.publish(event));
    this.heartbeat = setInterval(() => this.checkHeartbeats(), this.options.heartbeatMs);
  }

  close() {
    clearInterval(this.heartbeat);
    this.unsubscribe();
    for (const conn of this.connections) conn.ws.terminate();
    this.wss.close();
  }

  // ---------- connection lifecycle ----------

  private onConnection(ws: WebSocket) {
    const conn: Connection = {
      ws,
      agent: null,
      pending: null,
      viewing: null,
      typing: false,
      alive: true,
      inbox: Promise.resolve(),
    };
    this.connections.add(conn);

    const helloTimer = setTimeout(() => {
      if (!conn.agent) ws.close(CLOSE_CODES.BAD_HELLO, 'Send a hello message first');
    }, this.options.helloTimeoutMs);

    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data) => {
      conn.alive = true;
      conn.inbox = conn.inbox
        .then(() => this.onMessage(conn, data))
        .catch((err: unknown) => {
          this.deps.logger.error({ err }, 'realtime message failed');
          ws.close(1011, 'Server error');
        });
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      this.remove(conn);
    });
    ws.on('error', (err) => this.deps.logger.warn({ err }, 'websocket error'));
  }

  private async onMessage(conn: Connection, data: RawData) {
    const parsed = ClientMessage.safeParse(safeJson(data));
    if (!parsed.success) {
      this.send(conn, { type: 'error', code: 'BAD_MESSAGE', message: 'Unrecognised message' });
      if (!conn.agent) conn.ws.close(CLOSE_CODES.BAD_HELLO, 'Send a hello message first');
      return;
    }
    const message = parsed.data;

    if (message.type === 'hello') {
      await this.onHello(conn, message.agentId, message.since);
      return;
    }
    if (!conn.agent) {
      conn.ws.close(CLOSE_CODES.BAD_HELLO, 'Send a hello message first');
      return;
    }
    if (message.type === 'viewing') this.setViewing(conn, message.ticketId);
    else this.setTyping(conn, message.ticketId, message.typing);
  }

  private async onHello(conn: Connection, agentId: string, since: number | null) {
    if (conn.agent) return;
    const [agent] = await this.deps.db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent) {
      this.send(conn, { type: 'error', code: 'UNKNOWN_AGENT', message: `No agent ${agentId}` });
      conn.ws.close(CLOSE_CODES.UNKNOWN_AGENT, 'Unknown agent');
      return;
    }

    // From here on, live events for this connection queue up in `pending`. They are flushed
    // after the replay, skipping anything the replay already covered, so nothing is missed
    // and nothing arrives out of order.
    conn.agent = agent;
    conn.pending = [];

    const catchUp = await this.planCatchUp(since);
    for (const event of catchUp.events) this.send(conn, { type: 'event', event });
    this.send(conn, { type: 'ready', mode: catchUp.mode, seq: catchUp.seq });

    const queued = conn.pending;
    conn.pending = null;
    for (const event of queued) {
      if (event.seq > catchUp.seq) this.send(conn, { type: 'event', event });
    }
    this.send(conn, { type: 'presence.snapshot', tickets: this.allPresence() });
  }

  /**
   * "resumed" when every event after `since` is still in the log and there aren't too many;
   * otherwise "snapshot", and the browser refetches over REST.
   */
  private async planCatchUp(since: number | null): Promise<{
    mode: 'resumed' | 'snapshot';
    seq: number;
    events: TicketEvent[];
  }> {
    const { oldest, head } = await eventRange(this.deps.db);
    const top = head ?? 0;
    const snapshot = { mode: 'snapshot' as const, seq: top, events: [] };

    if (since === null) return snapshot; // first connection: nothing to resume from
    if (since > top) return snapshot; // the log was reset since this browser last saw it
    if (since === top) return { mode: 'resumed', seq: top, events: [] };
    if (oldest !== null && since < oldest - 1) return snapshot; // events it missed were pruned
    if (top - since > this.options.maxReplay) return snapshot; // cheaper to refetch

    const read = this.deps.readEvents ?? readEventsSince;
    const events = await read(this.deps.db, since, this.options.maxReplay);
    return { mode: 'resumed', seq: events.at(-1)?.seq ?? since, events };
  }

  private remove(conn: Connection) {
    this.connections.delete(conn);
    clearTimeout(conn.typingTimer);
    if (conn.agent && conn.viewing) this.publishPresence(conn.viewing);
  }

  /** Drops connections that didn't answer the last ping, e.g. a laptop that went to sleep. */
  private checkHeartbeats() {
    for (const conn of this.connections) {
      if (!conn.alive) {
        conn.ws.terminate(); // fires 'close', which clears this agent's presence
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
      if (conn.agent && !conn.pending) this.send(conn, { type: 'heartbeat' });
    }
  }

  // ---------- events ----------

  private publish(event: TicketEvent) {
    for (const conn of this.connections) {
      if (!conn.agent) continue;
      if (conn.pending) conn.pending.push(event);
      else this.send(conn, { type: 'event', event });
    }
  }

  // ---------- presence ----------

  private setViewing(conn: Connection, ticketId: string | null) {
    if (conn.viewing === ticketId) return;
    const previous = conn.viewing;
    conn.viewing = ticketId;
    conn.typing = false;
    clearTimeout(conn.typingTimer);
    if (previous) this.publishPresence(previous);
    if (ticketId) this.publishPresence(ticketId);
  }

  private setTyping(conn: Connection, ticketId: string, typing: boolean) {
    if (conn.viewing !== ticketId) this.setViewing(conn, ticketId); // typing implies viewing
    clearTimeout(conn.typingTimer);
    if (typing) {
      conn.typingTimer = setTimeout(
        () => this.setTyping(conn, ticketId, false),
        this.options.typingTimeoutMs,
      );
    }
    if (conn.typing === typing) return;
    conn.typing = typing;
    this.publishPresence(ticketId);
  }

  /** One entry per agent, even if they have the ticket open in two tabs. */
  private viewersOf(ticketId: string): Viewer[] {
    const byAgent = new Map<string, Viewer>();
    for (const conn of this.connections) {
      if (!conn.agent || conn.viewing !== ticketId) continue;
      const viewer = byAgent.get(conn.agent.id);
      if (viewer) viewer.typing ||= conn.typing;
      else byAgent.set(conn.agent.id, { agent: conn.agent, typing: conn.typing });
    }
    return [...byAgent.values()].sort((a, b) => a.agent.name.localeCompare(b.agent.name));
  }

  private allPresence(): Record<string, Viewer[]> {
    const tickets: Record<string, Viewer[]> = {};
    for (const conn of this.connections) {
      if (conn.agent && conn.viewing) tickets[conn.viewing] ??= this.viewersOf(conn.viewing);
    }
    return tickets;
  }

  private publishPresence(ticketId: string) {
    const message: ServerMessage = {
      type: 'presence',
      ticketId,
      viewers: this.viewersOf(ticketId),
    };
    for (const conn of this.connections) {
      // Connections still catching up get the full picture in their presence.snapshot instead
      if (conn.agent && !conn.pending) this.send(conn, message);
    }
  }

  private send(conn: Connection, message: ServerMessage) {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(message));
  }
}

function safeJson(data: RawData): unknown {
  try {
    // RawData is a Buffer for text frames from browsers, which is all Relay expects
    return JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : '');
  } catch {
    return undefined;
  }
}
