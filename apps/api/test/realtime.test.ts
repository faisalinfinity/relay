import { randomUUID } from 'node:crypto';
import { CLOSE_CODES } from '@relay/shared';
import { asc, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ticketEvents, type AgentRow, type TicketRow } from '../src/db/schema';
import { pruneEvents, readEventsSince } from '../src/realtime/events';
import {
  call,
  createAgent,
  createTicket,
  resetDb,
  sendSignedSubmission,
  startTestServer,
  type TestServer,
} from './helpers';
import { TestSocket } from './ws-client';

let server: TestServer;
let asha: AgentRow;
let ben: AgentRow;
let ticket: TicketRow;
const sockets: TestSocket[] = [];

/** When set, runs in place of the hub's replay read, so a test can commit events mid-replay. */
let interceptReplayRead: typeof readEventsSince | null = null;

beforeAll(async () => {
  server = await startTestServer(
    { typingTimeoutMs: 300 },
    {
      readEvents: (db, since, limit) => (interceptReplayRead ?? readEventsSince)(db, since, limit),
    },
  );
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await resetDb(server.db);
  asha = await createAgent(server.db, 'Asha Rao');
  ben = await createAgent(server.db, 'Ben Okafor');
  ticket = await createTicket(server.db);
});
afterEach(async () => {
  interceptReplayRead = null;
  await Promise.all(sockets.splice(0).map((socket) => socket.close()));
});

/** Opens a socket, says hello, and waits until the server says it is caught up. */
async function connect(agent: AgentRow, since: number | null = null) {
  const socket = await TestSocket.open(server.wsUrl);
  sockets.push(socket);
  socket.send({ type: 'hello', agentId: agent.id, since });
  const ready = await socket.next('ready');
  return { socket, ready };
}

const claim = (agent: AgentRow, id = ticket.id) =>
  call(server, 'POST', `/api/tickets/${id}/claim`, { agent });

function newSubmission(subject = 'Calendar stopped syncing') {
  return sendSignedSubmission(server, {
    submissionId: randomUUID(),
    name: 'Priya Shah',
    email: 'priya@example.com',
    subject,
    message: 'Since yesterday new bookings are missing from Google Calendar.',
  });
}

async function allSeqsAfter(since: number) {
  const rows = await server.db
    .select({ seq: ticketEvents.seq })
    .from(ticketEvents)
    .where(sql`${ticketEvents.seq} > ${since}`)
    .orderBy(asc(ticketEvents.seq));
  return rows.map((row) => row.seq);
}

describe('live events', () => {
  it('starts a first connection in snapshot mode', async () => {
    const { ready } = await connect(asha);
    expect(ready.mode).toBe('snapshot');
  });

  it('pushes a claim to every connected agent, with the new owner and version', async () => {
    const { socket: a } = await connect(asha);
    const { socket: b } = await connect(ben);

    await claim(ben);

    for (const socket of [a, b]) {
      const { event } = await socket.next('event');
      expect(event).toMatchObject({
        kind: 'ticket.claimed',
        ticket: { id: ticket.id, owner: { id: ben.id, name: 'Ben Okafor' }, version: 2 },
        actor: { id: ben.id },
      });
    }
  });

  it('pushes a ticket from the website form with its first message', async () => {
    const { socket } = await connect(asha);

    const res = await newSubmission('Need help with SW-1042');

    const { event } = await socket.next('event');
    expect(event).toMatchObject({
      kind: 'ticket.created',
      ticket: { id: res.body.data.ticketId, subject: 'Need help with SW-1042', owner: null },
      message: { authorType: 'customer' },
      actor: null,
    });
  });

  it('pushes replies and closes, and nothing for a claim that lost', async () => {
    const { socket } = await connect(ben);

    await claim(asha);
    expect((await claim(ben)).status).toBe(409); // must not produce an event
    await call(server, 'POST', `/api/tickets/${ticket.id}/reply`, {
      agent: asha,
      json: { body: 'Reconnect your calendar under Settings.' },
    });
    await call(server, 'POST', `/api/tickets/${ticket.id}/close`, { agent: asha });

    const kinds = [];
    for (let i = 0; i < 3; i++) kinds.push((await socket.next('event')).event);
    expect(kinds.map((e) => e.kind)).toEqual(['ticket.claimed', 'ticket.replied', 'ticket.closed']);
    expect(kinds[1]!.message).toMatchObject({ body: 'Reconnect your calendar under Settings.' });
    expect(kinds[2]!.ticket).toMatchObject({ status: 'closed', version: 4 });
  });
});

describe('presence', () => {
  it('shows who has a ticket open and who is typing, and clears when they disconnect', async () => {
    const { socket: a } = await connect(asha);
    const { socket: b } = await connect(ben);
    const forTicket = (m: { ticketId: string }) => m.ticketId === ticket.id;

    a.send({ type: 'viewing', ticketId: ticket.id });
    expect((await b.next('presence', forTicket)).viewers).toEqual([
      { agent: { id: asha.id, name: 'Asha Rao' }, typing: false },
    ]);

    a.send({ type: 'typing', ticketId: ticket.id, typing: true });
    expect((await b.next('presence', forTicket)).viewers).toMatchObject([{ typing: true }]);

    await a.close(); // the tab closes, or the connection drops
    expect((await b.next('presence', forTicket)).viewers).toEqual([]);
  });

  it('clears "typing" on its own when the typist goes quiet', async () => {
    const { socket: a } = await connect(asha);
    const { socket: b } = await connect(ben);

    a.send({ type: 'typing', ticketId: ticket.id, typing: true });
    await b.next('presence', (m) => m.viewers[0]?.typing === true);
    // typingTimeoutMs is 300ms in these tests
    const quiet = await b.next('presence', (m) => m.viewers[0]?.typing === false, 2_000);
    expect(quiet.viewers).toHaveLength(1);
  });

  it('lists an agent once, however many tabs they have open', async () => {
    const { socket: tab1 } = await connect(asha);
    const { socket: tab2 } = await connect(asha);
    const { socket: watcher } = await connect(ben);

    tab1.send({ type: 'viewing', ticketId: ticket.id });
    await watcher.next('presence');
    tab2.send({ type: 'viewing', ticketId: ticket.id });
    expect((await watcher.next('presence')).viewers).toHaveLength(1);

    await tab1.close(); // still open in tab 2
    expect((await watcher.next('presence')).viewers).toHaveLength(1);
  });

  it('tells a newly connected agent who is already looking at what', async () => {
    const { socket: a } = await connect(asha);
    a.send({ type: 'viewing', ticketId: ticket.id });
    await a.next('presence');

    const { socket: b } = await connect(ben);
    const snapshot = await b.next('presence.snapshot');
    expect(snapshot.tickets[ticket.id]).toEqual([
      { agent: { id: asha.id, name: 'Asha Rao' }, typing: false },
    ]);
  });
});

describe('reconnecting', () => {
  beforeEach(async () => {
    // In a running system the log is never empty (pruning keeps the newest event)
    await newSubmission('Already in the queue');
  });

  it('replays exactly what was missed, in order, then says it resumed', async () => {
    const { socket: before, ready: first } = await connect(asha);
    await before.close(); // laptop goes to sleep

    await claim(ben);
    await call(server, 'POST', `/api/tickets/${ticket.id}/reply`, {
      agent: ben,
      json: { body: 'Looking into it' },
    });
    await newSubmission();

    const after = await TestSocket.open(server.wsUrl);
    sockets.push(after);
    after.send({ type: 'hello', agentId: asha.id, since: first.seq });
    const ready = await after.next('ready');

    const replayed = after.received.filter((m) => m.type === 'event').map((m) => m.event);
    expect(replayed.map((e) => e.kind)).toEqual([
      'ticket.claimed',
      'ticket.replied',
      'ticket.created',
    ]);
    expect(replayed.map((e) => e.seq)).toEqual(await allSeqsAfter(first.seq));
    expect(ready).toEqual({ type: 'ready', mode: 'resumed', seq: replayed.at(-1)!.seq });
    // The replay already carried the owner change, so there is no stale owner to show
    expect(replayed[0]!.ticket.owner).toEqual({ id: ben.id, name: 'Ben Okafor' });
  });

  it('neither drops nor repeats events that commit while it is catching up', async () => {
    const { socket: watcher } = await connect(ben);
    const { socket: before, ready: first } = await connect(asha);
    await before.close();
    for (let i = 0; i < 3; i++) await newSubmission(`Missed ${i}`);

    /** Commits `count` tickets and waits until the hub has published them to live sockets. */
    const commitAndPublish = async (label: string, count: number) => {
      for (let i = 0; i < count; i++) await newSubmission(`${label} ${i}`);
      await watcher.next('event', (m) => m.event.ticket.subject === `${label} ${count - 1}`);
    };

    // Pin the race down instead of hoping for it: while the reconnecting socket is catching
    // up, events get published both just before its replay read (so they are in the replay
    // AND queued live) and just after it (so they are only queued live).
    interceptReplayRead = async (db, since, limit) => {
      interceptReplayRead = null;
      await commitAndPublish('Before read', 3);
      const replay = await readEventsSince(db, since, limit);
      await commitAndPublish('After read', 3);
      return replay;
    };

    const after = await TestSocket.open(server.wsUrl);
    sockets.push(after);
    after.send({ type: 'hello', agentId: asha.id, since: first.seq });
    await after.next('ready');

    const expected = await allSeqsAfter(first.seq);
    expect(expected).toHaveLength(9);
    await after.next('event', (m) => m.event.seq === expected.at(-1));
    const seqs = after.received.filter((m) => m.type === 'event').map((m) => m.event.seq);
    expect(seqs).toEqual(expected); // every event once, in order
  });

  it('asks the browser to refetch when it cannot replay the gap', async () => {
    const { socket: before, ready: first } = await connect(asha);
    await before.close();
    await claim(ben);
    await newSubmission();

    // A seq this server never issued, e.g. from before the database was reset
    expect((await connect(asha, first.seq + 1_000_000)).ready.mode).toBe('snapshot');

    // The events after `since` were deleted (pruned, or the database was re-seeded)
    await server.db.execute(sql`delete from ticket_events`);
    await newSubmission();
    const { ready } = await connect(asha, first.seq);
    expect(ready.mode).toBe('snapshot');
  });
});

describe('handshake', () => {
  it('closes the connection for an unknown agent', async () => {
    const socket = await TestSocket.open(server.wsUrl);
    socket.send({ type: 'hello', agentId: randomUUID(), since: null });
    expect((await socket.closed).code).toBe(CLOSE_CODES.UNKNOWN_AGENT);
  });

  it('closes the connection if the first message is not a hello', async () => {
    const socket = await TestSocket.open(server.wsUrl);
    socket.send({ type: 'viewing', ticketId: ticket.id });
    expect((await socket.closed).code).toBe(CLOSE_CODES.BAD_HELLO);
  });
});

describe('pruning', () => {
  it('keeps the newest event so the log head survives a quiet period', async () => {
    await newSubmission('one');
    await newSubmission('two');
    await server.db.execute(sql`update ticket_events set created_at = now() - interval '2 days'`);

    const deleted = await pruneEvents(server.db, 24);

    const left = await allSeqsAfter(0);
    expect(deleted).toBe(1);
    expect(left).toHaveLength(1);
  });
});
