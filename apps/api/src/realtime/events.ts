import type { AgentRef, Message, TicketEvent, TicketEventKind, TicketSummary } from '@relay/shared';
import { and, asc, gt, lt, max, min, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { ticketEvents } from '../db/schema';

export const EVENTS_CHANNEL = 'relay_events';

/** Arbitrary constant naming the advisory lock that orders event writes. */
const EVENT_ORDER_LOCK = 7_201_001;

export interface NewEvent {
  kind: TicketEventKind;
  ticket: TicketSummary;
  message?: Message | null;
  actor?: AgentRef | null;
}

/**
 * Appends an event inside the caller's transaction and wakes every API instance up.
 * Call it as the last statement of the transaction.
 *
 * Why the advisory lock: `seq` comes from a sequence, and sequence numbers are handed out when the
 * INSERT runs, not when the transaction commits. Without the lock, transaction A could take seq 10,
 * B take seq 11, B commit first, and a reader would see 11 before 10 exists. A client that then
 * resumed "after 11" would never get 10. Holding the lock until commit means seq order equals
 * commit order, so "everything after N" is always complete. The cost: event writes are serialised.
 * That's fine here and is discussed in DESIGN.md.
 *
 * NOTIFY is transactional too: listeners hear about the event only once it is committed.
 */
export async function recordEvent(tx: Tx, event: NewEvent): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${EVENT_ORDER_LOCK})`);
  const [row] = await tx
    .insert(ticketEvents)
    .values({
      ticketId: event.ticket.id,
      kind: event.kind,
      payload: { ticket: event.ticket, message: event.message ?? null, actor: event.actor ?? null },
    })
    .returning({ seq: ticketEvents.seq });
  await tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${String(row!.seq)})`);
}

export async function readEventsSince(
  db: Db,
  since: number,
  limit: number,
): Promise<TicketEvent[]> {
  const rows = await db
    .select()
    .from(ticketEvents)
    .where(gt(ticketEvents.seq, since))
    .orderBy(asc(ticketEvents.seq))
    .limit(limit);
  return rows.map((row) => ({
    seq: row.seq,
    kind: row.kind,
    ticket: row.payload.ticket,
    message: row.payload.message,
    actor: row.payload.actor,
    at: row.createdAt.toISOString(),
  }));
}

/** The oldest and newest seq still in the log, or nulls when it is empty. */
export async function eventRange(db: Db): Promise<{ oldest: number | null; head: number | null }> {
  const [row] = await db
    .select({ oldest: min(ticketEvents.seq), head: max(ticketEvents.seq) })
    .from(ticketEvents);
  return { oldest: row?.oldest ?? null, head: row?.head ?? null };
}

/**
 * Deletes events older than `hours`. Browsers asleep for longer than that refetch instead.
 * The newest event is always kept. An empty log would report its head as 0, and every browser
 * that reconnected after the next event would then refetch, even if it had missed nothing.
 */
export async function pruneEvents(db: Db, hours: number): Promise<number> {
  const deleted = await db
    .delete(ticketEvents)
    .where(
      and(
        lt(ticketEvents.createdAt, sql`now() - make_interval(hours => ${hours})`),
        lt(ticketEvents.seq, sql`(select max(seq) from ticket_events)`),
      ),
    )
    .returning({ seq: ticketEvents.seq });
  return deleted.length;
}
