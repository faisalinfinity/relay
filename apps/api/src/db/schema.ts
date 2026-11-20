import type { AgentRef, Message, Suggestion, TicketEventKind, TicketSummary } from '@relay/shared';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const ticketStatus = pgEnum('ticket_status', ['open', 'closed']);
export const messageAuthorType = pgEnum('message_author_type', ['customer', 'agent']);

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: createdAt(),
});

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: integer('number').notNull().generatedAlwaysAsIdentity({ startWith: 1001 }),
    subject: text('subject').notNull(),
    status: ticketStatus('status').notNull().default('open'),
    ownerId: uuid('owner_id').references(() => agents.id),
    customerName: text('customer_name').notNull(),
    customerEmail: text('customer_email').notNull(),
    // Where the ticket came from, and that system's id for it. A resend of the same
    // form submission hits the unique index below instead of creating a second ticket.
    source: text('source').notNull().default('web_form'),
    externalId: text('external_id'),
    intakeHash: text('intake_hash'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('tickets_number_key').on(t.number),
    uniqueIndex('tickets_source_external_id_key').on(t.source, t.externalId),
    index('tickets_status_number_idx').on(t.status, t.number.desc()),
    index('tickets_owner_id_idx').on(t.ownerId),
    check('tickets_closed_at_check', sql`(${t.status} = 'closed') = (${t.closedAt} is not null)`),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorType: messageAuthorType('author_type').notNull(),
    agentId: uuid('agent_id').references(() => agents.id),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('messages_ticket_id_created_at_idx').on(t.ticketId, t.createdAt),
    check(
      'messages_agent_author_check',
      sql`(${t.authorType} = 'agent') = (${t.agentId} is not null)`,
    ),
  ],
);

export const articles = pgTable('articles', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  body: text('body').notNull(),
  contentHash: text('content_hash').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only log of ticket changes, written in the same transaction as the change itself.
 * Live updates are read from here, and a reconnecting browser replays from here.
 */
export const ticketEvents = pgTable(
  'ticket_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<TicketEventKind>().notNull(),
    payload: jsonb('payload')
      .$type<{ ticket: TicketSummary; message: Message | null; actor: AgentRef | null }>()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_events_created_at_idx').on(t.createdAt)],
);

/** nomic-embed-text produces 768 numbers per text. A model with another size needs a migration. */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Help articles split into sections, each with its embedding. `content_hash` covers exactly the
 * text that was embedded plus the model name, so re-ingesting only embeds chunks whose hash is new.
 */
export const articleChunks = pgTable(
  'article_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    heading: text('heading').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('article_chunks_article_hash_key').on(t.articleId, t.contentHash),
    // Approximate nearest-neighbour index for cosine distance (the <=> operator)
    index('article_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

/**
 * The last suggestion drafted for each ticket. Drafting takes seconds, so it's reused until its
 * inputs change: the ticket's question, the articles retrieved for it, or the models.
 */
export const ticketSuggestions = pgTable('ticket_suggestions', {
  ticketId: uuid('ticket_id')
    .primaryKey()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  inputHash: text('input_hash').notNull(),
  suggestion: jsonb('suggestion').$type<Suggestion>().notNull(),
  createdAt: createdAt(),
});

export type AgentRow = typeof agents.$inferSelect;
export type TicketRow = typeof tickets.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
