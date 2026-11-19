import { eq, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tickets, type AgentRow } from '../src/db/schema';
import {
  call,
  createAgent,
  createTicket,
  resetDb,
  startTestServer,
  waitUntil,
  type TestServer,
} from './helpers';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await resetDb(server.db);
});

const claim = (ticketId: string, agent: AgentRow) =>
  call(server, 'POST', `/api/tickets/${ticketId}/claim`, { agent });

/**
 * Claim UPDATEs currently blocked on a row lock, as seen by Postgres itself.
 * Runs on its own pooled connection: pg_stat_activity is snapshotted once per transaction,
 * so polling it from inside the gate's open transaction would keep returning the first answer.
 */
async function claimsWaitingOnLock(): Promise<number> {
  const { rows } = await server.pool.query<{ waiting: number }>(
    `select count(*)::int as waiting
       from pg_stat_activity
      where datname = current_database()
        and wait_event_type = 'Lock'
        and query ilike 'update "tickets" set "owner_id"%'`,
  );
  return rows[0]?.waiting ?? 0;
}

/**
 * Fires all `requests` while another connection holds the ticket's row lock, waits until
 * Postgres reports every one of them blocked inside its claim UPDATE, then releases the lock.
 * This guarantees the claims really overlap in the database, instead of hoping that
 * Promise.all happens to line them up.
 */
async function raceOnRowLock<T>(ticketId: string, requests: Array<() => Promise<T>>): Promise<T[]> {
  const gate = await server.pool.connect();
  try {
    await gate.query('begin');
    await gate.query('select 1 from tickets where id = $1 for update', [ticketId]);
    const inFlight = Promise.all(requests.map((request) => request()));
    await waitUntil(async () => (await claimsWaitingOnLock()) === requests.length);
    await gate.query('commit');
    return await inFlight;
  } catch (error) {
    await gate.query('rollback');
    throw error;
  } finally {
    gate.release();
  }
}

describe('claim rule: a ticket has one owner', () => {
  it('gives one of two simultaneous claims a 200 and the other a 409 naming the winner', async () => {
    const asha = await createAgent(server.db, 'Asha Rao');
    const ben = await createAgent(server.db, 'Ben Okafor');
    const ticket = await createTicket(server.db);

    const results = await raceOnRowLock(ticket.id, [
      () => claim(ticket.id, asha),
      () => claim(ticket.id, ben),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!.body.data.owner;
    const loser = results.find((r) => r.status === 409)!.body.error;

    expect(loser.code).toBe('TICKET_ALREADY_CLAIMED');
    expect(loser.details.owner).toEqual(winner);
    expect(loser.details.ticketId).toBe(ticket.id);
    expect(loser.message).toMatch(
      new RegExp(`^${winner.name} claimed ticket #${ticket.number} just now`),
    );

    const [row] = await server.db.select().from(tickets).where(eq(tickets.id, ticket.id));
    expect(row!.ownerId).toBe(winner.id);
    expect(row!.version).toBe(2); // exactly one update was applied
  });

  it('lets exactly one of 20 agents win a stampede', async () => {
    const crowd = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createAgent(server.db, `Agent ${i + 1}`)),
    );
    const ticket = await createTicket(server.db);

    const results = await raceOnRowLock(
      ticket.id,
      crowd.map((agent) => () => claim(ticket.id, agent)),
    );

    const wins = results.filter((r) => r.status === 200);
    const losses = results.filter((r) => r.status === 409);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(19);
    for (const loss of losses) {
      expect(loss.body.error.code).toBe('TICKET_ALREADY_CLAIMED');
      expect(loss.body.error.details.owner.id).toBe(wins[0]!.body.data.owner.id);
    }
  });

  it('treats a double click by the same agent as success both times', async () => {
    const asha = await createAgent(server.db, 'Asha Rao');
    const ticket = await createTicket(server.db);

    const results = await raceOnRowLock(ticket.id, [
      () => claim(ticket.id, asha),
      () => claim(ticket.id, asha),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const [row] = await server.db.select().from(tickets).where(eq(tickets.id, ticket.id));
    expect(row!.ownerId).toBe(asha.id);
    expect(row!.version).toBe(2);
  });

  it('holds over 50 rounds of unsynchronised double clicks', async () => {
    const asha = await createAgent(server.db, 'Asha Rao');
    const ben = await createAgent(server.db, 'Ben Okafor');

    for (let round = 0; round < 50; round++) {
      const ticket = await createTicket(server.db, { subject: `Round ${round}` });
      const results = await Promise.all([claim(ticket.id, asha), claim(ticket.id, ben)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    }

    const owned = await server.db.select().from(tickets).where(isNotNull(tickets.ownerId));
    expect(owned).toHaveLength(50);
    expect(owned.every((t) => t.version === 2)).toBe(true);
  });
});
