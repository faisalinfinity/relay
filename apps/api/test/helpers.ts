import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { pino } from 'pino';
import { createApp } from '../src/app';
import { createDb, type Db } from '../src/db/client';
import { agents, messages, tickets, type AgentRow, type TicketRow } from '../src/db/schema';
import { AGENT_HEADER } from '../src/http/agent';
import { RealtimeHub, type HubDeps, type RealtimeOptions } from '../src/realtime/hub';
import { EventRelay } from '../src/realtime/relay';
import { createSuggestionService, type SuggestionDeps } from '../src/suggestions/service';
import { SIGNATURE_HEADER, signPayload } from '../src/webhooks/signature';
import { answer, FakeChat, FakeEmbedder } from './fakes';
import { TEST_DATABASE_URL } from './env';

export const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface TestServer {
  db: Db;
  pool: pg.Pool;
  baseUrl: string;
  wsUrl: string;
  close(): Promise<void>;
}

/**
 * The whole API (HTTP, WebSocket hub, event relay) on a random port, so concurrent requests
 * really are concurrent.
 */
export async function startTestServer(
  realtimeOptions: Partial<RealtimeOptions> = {},
  hubDeps: Pick<HubDeps, 'readEvents'> = {},
  ai: Partial<Omit<SuggestionDeps, 'db'>> = {},
): Promise<TestServer> {
  const logger = pino({ level: 'silent' });
  const { db, pool } = createDb(TEST_DATABASE_URL, { max: 30 });
  const relay = new EventRelay(db, TEST_DATABASE_URL, logger);
  await relay.start();
  const suggestions = createSuggestionService({
    db,
    embedder: new FakeEmbedder(),
    chat: new FakeChat(() => answer('Hi there! [1]', [1])),
    minSimilarity: 0.3,
    helpCenterUrl: 'https://help.test/articles',
    ...ai,
  });
  const app = createApp({
    db,
    webhook: { secret: WEBHOOK_SECRET, toleranceSeconds: WEBHOOK_TOLERANCE_SECONDS },
    suggestions,
    logger,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const hub = new RealtimeHub(server, { db, relay, logger, ...hubDeps }, realtimeOptions);
  const { port } = server.address() as AddressInfo;

  return {
    db,
    pool,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    async close() {
      hub.close();
      await relay.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await pool.end();
    },
  };
}

/**
 * Empties every table. Ticket numbers restart at 1001, but the event seq deliberately keeps
 * counting: a running relay remembers the last seq it delivered, as it would in production.
 */
export async function resetDb(db: Db) {
  await db.execute(
    sql`truncate table ticket_suggestions, ticket_events, messages, tickets, agents, article_chunks, articles`,
  );
  await db.execute(sql`alter table tickets alter column number restart with 1001`);
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

/** Posts a correctly signed submission to the intake webhook. */
export async function sendSignedSubmission(
  server: TestServer,
  submission: {
    submissionId: string;
    name: string;
    email: string;
    subject: string;
    message: string;
  },
): Promise<ApiResult> {
  const rawBody = JSON.stringify(submission);
  return call(server, 'POST', '/webhooks/tickets', {
    rawBody,
    headers: { [SIGNATURE_HEADER]: signPayload(WEBHOOK_SECRET, rawBody) },
  });
}
