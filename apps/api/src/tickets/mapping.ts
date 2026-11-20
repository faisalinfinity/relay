import type { AgentRef, Message, TicketSummary } from '@relay/shared';
import type { AgentRow, MessageRow, TicketRow } from '../db/schema';

/** Database rows → the shapes the API sends (see packages/shared). */

export function toSummary({
  ticket,
  ownerName,
}: {
  ticket: TicketRow;
  ownerName: string | null;
}): TicketSummary {
  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    status: ticket.status,
    owner: ticket.ownerId && ownerName !== null ? { id: ticket.ownerId, name: ownerName } : null,
    customer: { name: ticket.customerName, email: ticket.customerEmail },
    claimedAt: ticket.claimedAt?.toISOString() ?? null,
    closedAt: ticket.closedAt?.toISOString() ?? null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    version: ticket.version,
  };
}

export function toMessage(row: MessageRow, agent: AgentRef | null): Message {
  return {
    id: row.id,
    ticketId: row.ticketId,
    authorType: row.authorType,
    agent,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export const toAgentRef = (agent: AgentRow): AgentRef => ({ id: agent.id, name: agent.name });
