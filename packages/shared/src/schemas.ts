import { z } from 'zod';

// ---------- Domain objects as they appear on the wire ----------

export const TicketStatus = z.enum(['open', 'closed']);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const Agent = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
});
export type Agent = z.infer<typeof Agent>;

export const AgentRef = Agent.pick({ id: true, name: true });
export type AgentRef = z.infer<typeof AgentRef>;

export const TicketSummary = z.object({
  id: z.uuid(),
  /** Human-friendly number shown in the UI, e.g. #1042 */
  number: z.number().int(),
  subject: z.string(),
  status: TicketStatus,
  owner: AgentRef.nullable(),
  customer: z.object({ name: z.string(), email: z.string() }),
  claimedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Goes up by one on every change; lets a client ignore updates older than what it has. */
  version: z.number().int(),
});
export type TicketSummary = z.infer<typeof TicketSummary>;

export const MessageAuthorType = z.enum(['customer', 'agent']);
export type MessageAuthorType = z.infer<typeof MessageAuthorType>;

export const Message = z.object({
  id: z.uuid(),
  ticketId: z.uuid(),
  authorType: MessageAuthorType,
  /** Set when authorType is "agent" */
  agent: AgentRef.nullable(),
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type Message = z.infer<typeof Message>;

export const TicketDetail = TicketSummary.extend({ messages: z.array(Message) });
export type TicketDetail = z.infer<typeof TicketDetail>;

// ---------- Requests ----------

export const TicketParams = z.object({ id: z.uuid({ error: 'Ticket id must be a UUID' }) });

/** "unassigned", "me" (needs X-Agent-Id) or an agent id */
export const OwnerFilter = z.union([z.literal('unassigned'), z.literal('me'), z.uuid()], {
  error: 'owner must be "unassigned", "me" or an agent id',
});
export type OwnerFilter = z.infer<typeof OwnerFilter>;

export const ListTicketsQuery = z.object({
  status: TicketStatus.optional(),
  owner: OwnerFilter.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** Opaque: pass back the `nextCursor` from the previous page. */
  cursor: z
    .string()
    .regex(/^\d{1,10}$/, 'cursor must be a value returned as nextCursor')
    .optional(),
});
export type ListTicketsQuery = z.infer<typeof ListTicketsQuery>;

export const ReplyBody = z.object({
  body: z.string().trim().min(1, 'Reply cannot be empty').max(10_000),
});
export type ReplyBody = z.infer<typeof ReplyBody>;

/**
 * What the website's contact form backend posts to POST /webhooks/tickets.
 * `submissionId` is created once per form submission, so a retry of the same
 * submission carries the same id.
 */
export const IntakeTicketPayload = z.object({
  submissionId: z.string().trim().min(8).max(128),
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(10_000),
});
export type IntakeTicketPayload = z.infer<typeof IntakeTicketPayload>;

// ---------- Responses ----------

export interface DataResponse<T> {
  data: T;
}

export interface TicketPage {
  data: TicketSummary[];
  /** null when there are no more pages */
  nextCursor: string | null;
}

export interface ReplyResult {
  message: Message;
  ticket: TicketSummary;
}

export interface IntakeResult {
  ticketId: string;
  number: number;
  /** true when this submission was already received before */
  duplicate: boolean;
}

/** `details` on a TICKET_ALREADY_CLAIMED error, so the losing client can show the real owner. */
export const ClaimConflictDetails = z.object({
  ticketId: z.uuid(),
  owner: AgentRef,
  claimedAt: z.iso.datetime().nullable(),
});
export type ClaimConflictDetails = z.infer<typeof ClaimConflictDetails>;
