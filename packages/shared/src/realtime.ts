import { z } from 'zod';
import type { AgentRef, Message, TicketSummary } from './schemas';

export const TicketEventKind = z.enum([
  'ticket.created',
  'ticket.claimed',
  'ticket.released',
  'ticket.replied',
  'ticket.closed',
]);
export type TicketEventKind = z.infer<typeof TicketEventKind>;

/**
 * Something that happened to a ticket. `seq` is a position in one global, gap-free-in-commit-order
 * log, so a client that has seen up to N can ask for "everything after N" when it reconnects.
 * `ticket` is the full ticket after the change: applying events is "keep the highest version".
 */
export interface TicketEvent {
  seq: number;
  kind: TicketEventKind;
  ticket: TicketSummary;
  /** set for ticket.created (the customer's message) and ticket.replied */
  message: Message | null;
  /** the agent who did it; null when the customer did (a new ticket) */
  actor: AgentRef | null;
  at: string;
}

export interface Viewer {
  agent: AgentRef;
  typing: boolean;
}

// ---------- browser → server ----------

export const ClientMessage = z.discriminatedUnion('type', [
  /** First message on every connection. `since` is the last seq this browser applied. */
  z.object({
    type: z.literal('hello'),
    agentId: z.uuid(),
    since: z.number().int().nonnegative().nullable(),
  }),
  /** The ticket this tab has open, or null when it has none open. */
  z.object({ type: z.literal('viewing'), ticketId: z.uuid().nullable() }),
  z.object({ type: z.literal('typing'), ticketId: z.uuid(), typing: z.boolean() }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---------- server → browser ----------

export type ServerMessage =
  /**
   * Sent once the connection is caught up. "resumed": every event after `since` has been sent.
   * "snapshot": the gap could not be replayed, so refetch over REST; events after `seq` follow.
   */
  | { type: 'ready'; mode: 'resumed' | 'snapshot'; seq: number }
  | { type: 'event'; event: TicketEvent }
  | { type: 'presence'; ticketId: string; viewers: Viewer[] }
  | { type: 'presence.snapshot'; tickets: Record<string, Viewer[]> }
  /** Sent every few seconds so the browser can tell a silent connection from a dead one. */
  | { type: 'heartbeat' }
  | { type: 'error'; code: string; message: string };

/** WebSocket close codes the server uses (4000-4999 is the application range). */
export const CLOSE_CODES = {
  BAD_HELLO: 4001,
  UNKNOWN_AGENT: 4003,
} as const;
