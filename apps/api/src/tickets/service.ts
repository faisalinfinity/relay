import type {
  AgentRef,
  ClaimConflictDetails,
  ReplyResult,
  TicketDetail,
  TicketEventKind,
  TicketPage,
  TicketStatus,
  TicketSummary,
} from '@relay/shared';
import { and, asc, desc, eq, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Db } from '../db/client';
import { agents, messages, tickets, type AgentRow } from '../db/schema';
import { AppError } from '../http/errors';
import { recordEvent } from '../realtime/events';
import { toAgentRef, toMessage, toSummary } from './mapping';

const now = sql`now()`;
const nextVersion = sql`${tickets.version} + 1`;

export type OwnerQuery = { kind: 'unassigned' } | { kind: 'agent'; agentId: string };

export interface ListOptions {
  status?: TicketStatus;
  owner?: OwnerQuery;
  limit: number;
  /** ticket number of the last row on the previous page */
  cursor?: number;
}

export async function listTickets(db: Db, options: ListOptions): Promise<TicketPage> {
  const where: SQL[] = [];
  if (options.status) where.push(eq(tickets.status, options.status));
  if (options.owner?.kind === 'unassigned') where.push(isNull(tickets.ownerId));
  if (options.owner?.kind === 'agent') where.push(eq(tickets.ownerId, options.owner.agentId));
  // Keyset pagination on the ticket number: "give me tickets older than the last one I saw".
  // With OFFSET, every new ticket arriving at the top would shift the next page by one.
  if (options.cursor !== undefined) where.push(lt(tickets.number, options.cursor));

  const rows = await selectTicketWithOwner(db)
    .where(and(...where))
    .orderBy(desc(tickets.number))
    .limit(options.limit + 1); // one extra row tells us whether there is a next page

  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    data: page.map(toSummary),
    nextCursor: rows.length > options.limit && last ? String(last.ticket.number) : null,
  };
}

export async function getTicketDetail(db: Db, ticketId: string): Promise<TicketDetail> {
  const ticket = await findTicket(db, ticketId);
  if (!ticket) throw ticketNotFound(ticketId);

  const rows = await db
    .select({ message: messages, agentName: agents.name })
    .from(messages)
    .leftJoin(agents, eq(agents.id, messages.agentId))
    .where(eq(messages.ticketId, ticketId))
    .orderBy(asc(messages.createdAt), asc(messages.id));

  return {
    ...ticket,
    messages: rows.map(({ message, agentName }) =>
      toMessage(
        message,
        message.agentId && agentName ? { id: message.agentId, name: agentName } : null,
      ),
    ),
  };
}

/**
 * The one-owner rule. Two agents clicking claim at the same instant get exactly one success.
 *
 * It rests on a single conditional UPDATE. Postgres takes a row lock for the update, so a second
 * claim running at the same moment waits on that lock. Once the first commits, Postgres re-checks
 * the second one's WHERE against the new row, sees owner_id is no longer null, and updates
 * nothing. No application-level locking, and it holds across any number of API instances.
 */
export async function claimTicket(
  db: Db,
  ticketId: string,
  agent: AgentRow,
): Promise<TicketSummary> {
  // A second attempt only happens if the ticket was released between our UPDATE and the read.
  for (let attempt = 0; attempt < 2; attempt++) {
    const claimed = await transition(db, agent, {
      kind: 'ticket.claimed',
      set: { ownerId: agent.id, claimedAt: now },
      where: and(eq(tickets.id, ticketId), eq(tickets.status, 'open'), isNull(tickets.ownerId)),
      ownerName: agent.name,
    });
    if (claimed) return claimed;

    // Nothing was updated. Find out why, so the caller gets an answer they can act on.
    const current = await findTicket(db, ticketId);
    if (!current) throw ticketNotFound(ticketId);
    if (current.status === 'closed') throw ticketClosed(current);
    if (current.owner?.id === agent.id) return current; // double click: it is already yours
    if (current.owner) throw alreadyClaimed(current, current.owner);
  }
  throw new AppError('TICKET_BUSY', 'This ticket changed while you were claiming it. Try again.');
}

export async function releaseTicket(
  db: Db,
  ticketId: string,
  agent: AgentRow,
): Promise<TicketSummary> {
  const released = await transition(db, agent, {
    kind: 'ticket.released',
    set: { ownerId: null, claimedAt: null },
    where: ownedOpenTicket(ticketId, agent),
    ownerName: null,
  });
  if (released) return released;
  throw ownershipError(await findTicket(db, ticketId), ticketId, agent, 'release');
}

export async function closeTicket(
  db: Db,
  ticketId: string,
  agent: AgentRow,
): Promise<TicketSummary> {
  const closed = await transition(db, agent, {
    kind: 'ticket.closed',
    set: { status: 'closed', closedAt: now },
    where: ownedOpenTicket(ticketId, agent),
    ownerName: agent.name,
  });
  if (closed) return closed;
  throw ownershipError(await findTicket(db, ticketId), ticketId, agent, 'close');
}

/** Only the current owner can reply, so a customer never gets two answers from two agents. */
export async function replyToTicket(
  db: Db,
  ticketId: string,
  agent: AgentRow,
  body: string,
): Promise<ReplyResult> {
  return db.transaction(async (tx) => {
    // FOR UPDATE holds the ticket row until we commit. Without it the ticket could be released
    // and claimed by someone else between this check and the insert below.
    const [row] = await selectTicketWithOwner(tx)
      .where(eq(tickets.id, ticketId))
      .for('update', { of: tickets });
    const current = row && toSummary(row);
    if (!current || current.status !== 'open' || current.owner?.id !== agent.id) {
      throw ownershipError(current, ticketId, agent, 'reply');
    }

    const [message] = await tx
      .insert(messages)
      .values({ ticketId, authorType: 'agent', agentId: agent.id, body })
      .returning();
    const [ticket] = await tx
      .update(tickets)
      .set({ updatedAt: now, version: nextVersion })
      .where(eq(tickets.id, ticketId))
      .returning();
    if (!message || !ticket) throw new Error(`reply to ${ticketId} wrote no rows`);

    const result = {
      message: toMessage(message, toAgentRef(agent)),
      ticket: toSummary({ ticket, ownerName: agent.name }),
    };
    await recordEvent(tx, { kind: 'ticket.replied', ...result, actor: toAgentRef(agent) });
    return result;
  });
}

/**
 * Runs a conditional UPDATE and, when it matches, records the matching event in the same
 * transaction, so an event exists if and only if the change committed.
 * Returns undefined when the WHERE matched nothing.
 */
async function transition(
  db: Db,
  agent: AgentRow,
  change: {
    kind: TicketEventKind;
    set: PgUpdateSetSource<typeof tickets>;
    where: SQL | undefined;
    ownerName: string | null;
  },
): Promise<TicketSummary | undefined> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(tickets)
      .set({ ...change.set, updatedAt: now, version: nextVersion })
      .where(change.where)
      .returning();
    if (!row) return undefined;
    const ticket = toSummary({ ticket: row, ownerName: change.ownerName });
    await recordEvent(tx, { kind: change.kind, ticket, actor: toAgentRef(agent) });
    return ticket;
  });
}

// ---------- queries ----------

type Queryable = Pick<Db, 'select'>;

function selectTicketWithOwner(db: Queryable) {
  return db
    .select({ ticket: tickets, ownerName: agents.name })
    .from(tickets)
    .leftJoin(agents, eq(agents.id, tickets.ownerId));
}

async function findTicket(db: Db, ticketId: string): Promise<TicketSummary | undefined> {
  const [row] = await selectTicketWithOwner(db).where(eq(tickets.id, ticketId)).limit(1);
  return row && toSummary(row);
}

function ownedOpenTicket(ticketId: string, agent: AgentRow) {
  return and(eq(tickets.id, ticketId), eq(tickets.status, 'open'), eq(tickets.ownerId, agent.id));
}

// ---------- errors an agent can act on ----------

function ticketNotFound(ticketId: string) {
  return new AppError('TICKET_NOT_FOUND', `Ticket ${ticketId} does not exist.`);
}

function ticketClosed(ticket: TicketSummary) {
  return new AppError('TICKET_CLOSED', `Ticket #${ticket.number} is already closed.`);
}

function alreadyClaimed(ticket: TicketSummary, owner: AgentRef) {
  const details: ClaimConflictDetails = { ticketId: ticket.id, owner, claimedAt: ticket.claimedAt };
  const firstName = owner.name.split(' ')[0] ?? owner.name;
  return new AppError(
    'TICKET_ALREADY_CLAIMED',
    `${owner.name} claimed ticket #${ticket.number} ${timeAgo(ticket.claimedAt)}. ` +
      `Pick another ticket, or ask ${firstName} to release it.`,
    details,
  );
}

const VERBS = { release: 'release', reply: 'reply to', close: 'close' } as const;

function ownershipError(
  current: TicketSummary | undefined,
  ticketId: string,
  agent: AgentRow,
  action: keyof typeof VERBS,
): AppError {
  if (!current) return ticketNotFound(ticketId);
  if (current.status === 'closed') return ticketClosed(current);
  if (!current.owner) {
    return action === 'release'
      ? new AppError(
          'TICKET_NOT_CLAIMED',
          `Nobody owns ticket #${current.number}, so there is nothing to release.`,
        )
      : new AppError(
          'NOT_TICKET_OWNER',
          `Claim ticket #${current.number} before you ${VERBS[action]} it.`,
        );
  }
  if (current.owner.id !== agent.id) {
    return new AppError(
      'NOT_TICKET_OWNER',
      `${current.owner.name} owns ticket #${current.number}. Only the owner can ${VERBS[action]} it.`,
    );
  }
  // We own it and it is open, yet the conditional update matched nothing: it changed underneath us.
  return new AppError(
    'TICKET_BUSY',
    `Ticket #${current.number} changed while you were working on it. Try again.`,
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'already';
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `on ${iso.slice(0, 10)}`;
}
