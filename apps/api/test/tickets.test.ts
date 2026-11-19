import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { messages, type AgentRow, type TicketRow } from '../src/db/schema';
import {
  call,
  createAgent,
  createTicket,
  resetDb,
  startTestServer,
  type TestServer,
} from './helpers';

let server: TestServer;
let asha: AgentRow;
let ben: AgentRow;
let cara: AgentRow;
/** t[0] is the oldest ticket (#1001), t[6] the newest (#1007) */
let t: TicketRow[];

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  await resetDb(server.db);
  asha = await createAgent(server.db, 'Asha Rao');
  ben = await createAgent(server.db, 'Ben Okafor');
  cara = await createAgent(server.db, 'Cara Lim');
  const now = Date.now();
  const claimed = (agent: AgentRow) => ({ ownerId: agent.id, claimedAt: new Date(now) });
  t = [];
  for (const overrides of [
    {},
    claimed(asha),
    { ...claimed(ben), status: 'closed' as const, closedAt: new Date(now) },
    {},
    claimed(ben),
    {},
    {},
  ]) {
    t.push(await createTicket(server.db, { subject: `Ticket ${t.length + 1}`, ...overrides }));
  }
});

const numbers = (res: { body: { data: Array<{ number: number }> } }) =>
  res.body.data.map((x) => x.number);

describe('GET /api/tickets', () => {
  it('lists every ticket newest first, with owner names', async () => {
    const res = await call(server, 'GET', '/api/tickets');

    expect(res.status).toBe(200);
    expect(numbers(res)).toEqual([1007, 1006, 1005, 1004, 1003, 1002, 1001]);
    expect(res.body.data.find((x: { number: number }) => x.number === 1002).owner).toEqual({
      id: asha.id,
      name: 'Asha Rao',
    });
    expect(res.body.nextCursor).toBeNull();
  });

  it('filters by status and owner', async () => {
    const closed = await call(server, 'GET', '/api/tickets?status=closed');
    const unassigned = await call(server, 'GET', '/api/tickets?owner=unassigned');
    const bens = await call(server, 'GET', `/api/tickets?owner=${ben.id}`);
    const bensOpen = await call(server, 'GET', `/api/tickets?owner=${ben.id}&status=open`);
    const mine = await call(server, 'GET', '/api/tickets?owner=me', { agent: asha });

    expect(numbers(closed)).toEqual([1003]);
    expect(numbers(unassigned)).toEqual([1007, 1006, 1004, 1001]);
    expect(numbers(bens)).toEqual([1005, 1003]);
    expect(numbers(bensOpen)).toEqual([1005]);
    expect(numbers(mine)).toEqual([1002]);
  });

  it('needs an agent for owner=me', async () => {
    const res = await call(server, 'GET', '/api/tickets?owner=me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AGENT_REQUIRED');
  });

  it('pages with a cursor, and a ticket arriving mid-way does not shift the pages', async () => {
    const first = await call(server, 'GET', '/api/tickets?limit=3');
    expect(numbers(first)).toEqual([1007, 1006, 1005]);

    await createTicket(server.db, { subject: 'Arrived while paging' }); // #1008, at the top

    const second = await call(
      server,
      'GET',
      `/api/tickets?limit=3&cursor=${first.body.nextCursor}`,
    );
    const third = await call(
      server,
      'GET',
      `/api/tickets?limit=3&cursor=${second.body.nextCursor}`,
    );

    expect(numbers(second)).toEqual([1004, 1003, 1002]);
    expect(numbers(third)).toEqual([1001]);
    expect(third.body.nextCursor).toBeNull();
  });

  it('rejects bad query parameters with field-level details', async () => {
    const res = await call(server, 'GET', '/api/tickets?limit=0&status=pending');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'limit',
      'status',
    ]);
  });
});

describe('GET /api/tickets/:id', () => {
  it('returns the ticket with its messages in order', async () => {
    await server.db
      .insert(messages)
      .values({ ticketId: t[1]!.id, authorType: 'agent', agentId: asha.id, body: 'On it!' });

    const res = await call(server, 'GET', `/api/tickets/${t[1]!.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ number: 1002, owner: { name: 'Asha Rao' } });
    expect(res.body.data.messages).toMatchObject([
      { authorType: 'customer', agent: null, body: 'Hello, can you help?' },
      { authorType: 'agent', agent: { id: asha.id, name: 'Asha Rao' }, body: 'On it!' },
    ]);
  });

  it('404s for an unknown ticket and 400s for a malformed id', async () => {
    const missing = await call(server, 'GET', `/api/tickets/${randomUUID()}`);
    const malformed = await call(server, 'GET', '/api/tickets/not-a-uuid');

    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('TICKET_NOT_FOUND');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('acting as an agent', () => {
  it('requires a known agent for every write', async () => {
    const none = await call(server, 'POST', `/api/tickets/${t[0]!.id}/claim`);
    const unknown = await call(server, 'POST', `/api/tickets/${t[0]!.id}/claim`, {
      agent: randomUUID(),
    });
    const garbage = await call(server, 'POST', `/api/tickets/${t[0]!.id}/claim`, { agent: 'asha' });

    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('AGENT_REQUIRED');
    expect(unknown.body.error.code).toBe('UNKNOWN_AGENT');
    expect(garbage.body.error.code).toBe('UNKNOWN_AGENT');
  });
});

describe('POST /api/tickets/:id/claim', () => {
  it('claims an unassigned ticket and bumps its version', async () => {
    const res = await call(server, 'POST', `/api/tickets/${t[0]!.id}/claim`, { agent: cara });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ owner: { id: cara.id, name: 'Cara Lim' }, version: 2 });
    expect(res.body.data.claimedAt).not.toBeNull();
  });

  it('refuses a closed ticket', async () => {
    const res = await call(server, 'POST', `/api/tickets/${t[2]!.id}/claim`, { agent: cara });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TICKET_CLOSED');
  });
});

describe('POST /api/tickets/:id/release', () => {
  it('lets the owner hand a ticket back to the queue', async () => {
    const res = await call(server, 'POST', `/api/tickets/${t[1]!.id}/release`, { agent: asha });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ owner: null, claimedAt: null, version: 2 });
  });

  it('refuses anyone but the owner, naming the owner', async () => {
    const res = await call(server, 'POST', `/api/tickets/${t[1]!.id}/release`, { agent: ben });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({
      code: 'NOT_TICKET_OWNER',
      message: 'Asha Rao owns ticket #1002. Only the owner can release it.',
    });
  });

  it('says so when nobody owns the ticket', async () => {
    const res = await call(server, 'POST', `/api/tickets/${t[0]!.id}/release`, { agent: ben });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TICKET_NOT_CLAIMED');
  });
});

describe('POST /api/tickets/:id/reply', () => {
  it('adds the owner reply to the thread', async () => {
    const res = await call(server, 'POST', `/api/tickets/${t[1]!.id}/reply`, {
      agent: asha,
      json: { body: '  Thanks, I have reconnected your calendar.  ' },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.message).toMatchObject({
      authorType: 'agent',
      agent: { id: asha.id },
      body: 'Thanks, I have reconnected your calendar.',
    });
    expect(res.body.data.ticket.version).toBe(2);

    const detail = await call(server, 'GET', `/api/tickets/${t[1]!.id}`);
    expect(detail.body.data.messages).toHaveLength(2);
  });

  it('asks the agent to claim an unassigned ticket first', async () => {
    const res = await call(server, 'POST', `/api/tickets/${t[0]!.id}/reply`, {
      agent: ben,
      json: { body: 'Hi' },
    });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Claim ticket #1001 before you reply to it.');
  });

  it("refuses a reply to someone else's ticket", async () => {
    const res = await call(server, 'POST', `/api/tickets/${t[1]!.id}/reply`, {
      agent: ben,
      json: { body: 'Hi' },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_TICKET_OWNER');
  });

  it('validates the body', async () => {
    const empty = await call(server, 'POST', `/api/tickets/${t[1]!.id}/reply`, {
      agent: asha,
      json: { body: '   ' },
    });
    const broken = await call(server, 'POST', `/api/tickets/${t[1]!.id}/reply`, {
      agent: asha,
      rawBody: '{"body":',
    });

    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'body: Reply cannot be empty',
      details: [{ path: 'body', message: 'Reply cannot be empty' }],
    });
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe('INVALID_JSON');
  });
});

describe('POST /api/tickets/:id/close', () => {
  it('closes the ticket, after which it takes no more replies or claims', async () => {
    const closed = await call(server, 'POST', `/api/tickets/${t[1]!.id}/close`, { agent: asha });
    expect(closed.status).toBe(200);
    expect(closed.body.data).toMatchObject({ status: 'closed', owner: { id: asha.id } });
    expect(closed.body.data.closedAt).not.toBeNull();

    const reply = await call(server, 'POST', `/api/tickets/${t[1]!.id}/reply`, {
      agent: asha,
      json: { body: 'Hi' },
    });
    const claim = await call(server, 'POST', `/api/tickets/${t[1]!.id}/claim`, { agent: ben });
    expect(reply.body.error.code).toBe('TICKET_CLOSED');
    expect(claim.body.error.code).toBe('TICKET_CLOSED');
  });

  it('refuses anyone but the owner', async () => {
    const res = await call(server, 'POST', `/api/tickets/${t[4]!.id}/close`, { agent: asha });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_TICKET_OWNER');
  });
});

describe('the rest of the API', () => {
  it('lists agents by name', async () => {
    const res = await call(server, 'GET', '/api/agents');
    expect(res.body.data.map((a: { name: string }) => a.name)).toEqual([
      'Asha Rao',
      'Ben Okafor',
      'Cara Lim',
    ]);
  });

  it('answers unknown routes with the same error shape, including a request id', async () => {
    const res = await call(server, 'GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });
});
