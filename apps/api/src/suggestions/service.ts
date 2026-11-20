import { createHash } from 'node:crypto';
import type { RetrievedChunk, Suggestion } from '@relay/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { ChatModel, Embedder } from '../ai/models';
import type { Db } from '../db/client';
import { messages, tickets, ticketSuggestions } from '../db/schema';
import { AppError } from '../http/errors';
import { retrieve, type ChunkHit } from '../retrieval/search';
import { draftReply, finishReply, questionText, type Source, type TicketQuestion } from './draft';

export interface SuggestionDeps {
  db: Db;
  embedder: Embedder;
  chat: ChatModel;
  /** chunks below this cosine similarity don't count as covering the question */
  minSimilarity: number;
  /** base URL for article links in drafted replies */
  helpCenterUrl: string;
  /** how many chunks to search for, and how many relevant ones the model gets */
  searchLimit?: number;
  maxSources?: number;
}

/** Bump when the prompt changes, so cached drafts from the old prompt aren't reused. */
const PROMPT_VERSION = 5;

export type SuggestionService = ReturnType<typeof createSuggestionService>;

export function createSuggestionService(deps: SuggestionDeps) {
  const { db, embedder, chat } = deps;
  const searchLimit = deps.searchLimit ?? 6;
  const maxSources = deps.maxSources ?? 4;
  // Two agents opening the same ticket at once share one draft instead of generating two
  const inFlight = new Map<string, Promise<Suggestion>>();

  async function forTicket(ticketId: string, options: { refresh?: boolean } = {}) {
    const question = await loadQuestion(db, ticketId);
    const retrieval = await retrieve(db, embedder, questionText(question), {
      limit: searchLimit,
      minSimilarity: deps.minSimilarity,
    });

    const used = retrieval.relevant.slice(0, maxSources);
    const sources: Source[] = used.map((hit, i) => ({
      index: i + 1,
      slug: hit.slug,
      title: hit.title,
      heading: hit.heading,
      content: hit.content,
      url: `${deps.helpCenterUrl}/${hit.slug}`,
    }));
    const base = {
      retrieved: retrieval.hits.map((hit) => toRetrieved(hit, used)),
      models: { embedding: embedder.model, chat: chat.model },
    };

    // Nothing cleared the cut-off: say so, without asking a model to make something up
    if (sources.length === 0) {
      return {
        ...base,
        status: 'no_coverage',
        reason: 'no_relevant_articles',
        createdAt: new Date().toISOString(),
      } satisfies Suggestion;
    }

    // Drafting is the slow, costly step, so reuse the last draft while its inputs are the same
    const inputHash = createHash('sha256')
      .update(
        JSON.stringify([
          PROMPT_VERSION,
          embedder.model,
          chat.model,
          questionText(question),
          used.map((hit) => hit.contentHash),
        ]),
      )
      .digest('hex');

    if (!options.refresh) {
      const [cached] = await db
        .select({ suggestion: ticketSuggestions.suggestion })
        .from(ticketSuggestions)
        .where(
          and(eq(ticketSuggestions.ticketId, ticketId), eq(ticketSuggestions.inputHash, inputHash)),
        );
      if (cached) return cached.suggestion;
    }

    let pending = inFlight.get(inputHash);
    if (!pending) {
      pending = draftAndStore(ticketId, inputHash, question, sources, base).finally(() =>
        inFlight.delete(inputHash),
      );
      inFlight.set(inputHash, pending);
    }
    return pending;
  }

  async function draftAndStore(
    ticketId: string,
    inputHash: string,
    question: TicketQuestion,
    sources: Source[],
    base: Pick<Suggestion, 'retrieved' | 'models'>,
  ): Promise<Suggestion> {
    const draft = await draftReply(chat, question, sources);
    const createdAt = new Date().toISOString();
    const suggestion: Suggestion =
      draft.kind === 'declined' || draft.kind === 'not_grounded'
        ? {
            ...base,
            status: 'no_coverage',
            reason: draft.kind === 'declined' ? 'model_declined' : 'not_grounded',
            createdAt,
          }
        : {
            ...base,
            status: 'drafted',
            reply: finishReply(draft.reply, draft.cited),
            sources: [...new Map(draft.cited.map((s) => [s.slug, s])).values()].map((s) => ({
              slug: s.slug,
              title: s.title,
              url: s.url,
            })),
            createdAt,
          };

    await db
      .insert(ticketSuggestions)
      .values({ ticketId, inputHash, suggestion })
      .onConflictDoUpdate({
        target: ticketSuggestions.ticketId,
        set: { inputHash, suggestion, createdAt: sql`now()` },
      });
    return suggestion;
  }

  return { forTicket };
}

async function loadQuestion(db: Db, ticketId: string): Promise<TicketQuestion> {
  const [ticket] = await db
    .select({ subject: tickets.subject, customerName: tickets.customerName })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  if (!ticket) throw new AppError('TICKET_NOT_FOUND', `Ticket ${ticketId} does not exist.`);

  const customerMessages = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.ticketId, ticketId), eq(messages.authorType, 'customer')))
    .orderBy(asc(messages.createdAt));

  return {
    customerName: ticket.customerName,
    subject: ticket.subject,
    messages: customerMessages.map((m) => m.body),
  };
}

function toRetrieved(hit: ChunkHit, used: ChunkHit[]): RetrievedChunk {
  return {
    slug: hit.slug,
    title: hit.title,
    heading: hit.heading,
    similarity: Math.round(hit.similarity * 1000) / 1000,
    used: used.some((u) => u.chunkId === hit.chunkId),
  };
}
