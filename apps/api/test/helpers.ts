import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { pino } from 'pino';
import { createApp } from '../src/app';
import { createDb, type Db } from '../src/db/client';
import { agents, messages, tickets, type AgentRow, type TicketRow } from '../src/db/schema';
import { AGENT_HEADER } from '../src/http/agent';
import { TEST_DATABASE_URL } from './env';

export const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface TestServer {
  db: Db;
  pool: pg.Pool;
  baseUrl: string;
  close(): Promise<void>;
}

/** A real HTTP server on a random port, so concurrent requests really are concurrent. */
export async function startTestServer(): Promise<TestServer> {
  const { db, pool } = createDb(TEST_DATABASE_URL, { max: 30 });
  const app = createApp({
    db,
    webhook: { secret: WEBHOOK_SECRET, toleranceSeconds: WEBHOOK_TOLERANCE_SECONDS },
    logger: pino({ level: 'silent' }),
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  return {
    db,
    pool,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await pool.end();
    },
  };
}

export async function resetDb(db: Db) {
  await db.execute(
    sql`truncate table messages, tickets, agents, articles restart identity cascade`,
  );
}

export async function createAgent(db: Db, name: string): Promise<AgentRow> {
  const email = `${name.toLowerCase().replaceAll(' ', '.')}@relay.test`;
  const [agent] = await db.insert(agents).values({ name, email }).returning();
  return agent!;
}

export async function createTicket(
  db: Db,
  overrides: Partial<typeof tickets.$inferInsert> = {},
): Promise<TicketRow> {
  const [ticket] = await db
    .insert(tickets)
    .values({
      subject: 'My bookings are not syncing',
      customerName: 'Priya Shah',
      customerEmail: 'priya@example.com',
      ...overrides,
    })
    .returning();
  await db
    .insert(messages)
    .values({ ticketId: ticket!.id, authorType: 'customer', body: 'Hello, can you help?' });
  return ticket!;
}

export interface ApiResult {
  status: number;
  // Tests inspect arbitrary response shapes, so the body is left untyped here
  body: any;
}

export async function call(
  server: TestServer,
  method: 'GET' | 'POST',
  path: string,
  options: {
    agent?: Pick<AgentRow, 'id'> | string;
    json?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.agent) {
    headers[AGENT_HEADER] = typeof options.agent === 'string' ? options.agent : options.agent.id;
  }
  let body: string | undefined;
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.rawBody !== undefined) {
    headers['content-type'] ??= 'application/json';
    body = options.rawBody;
  }
  const res = await fetch(`${server.baseUrl}${path}`, { method, headers, body });
  return { status: res.status, body: await res.json() };
}

/** Polls until `check` returns true, failing after `timeoutMs`. */
export async function waitUntil(check: () => Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
