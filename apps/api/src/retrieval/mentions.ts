import { cosineDistance, inArray, sql } from 'drizzle-orm';
import type { Embedder } from '../ai/models';
import type { Db } from '../db/client';
import { articleChunks, articles } from '../db/schema';

/**
 * A term the help centre doesn't use can still be covered under another name: no article says
 * "receptionist", but the "Front desk" role answers that question. Measured with nomic-embed-text
 * on the evaluation questions: "receptionist" scores 0.639 against the Front desk section, while the
 * things no article covers ("Zoom", "integration", "gift cards", "Bitcoin", "servers") score
 * 0.48–0.57 against the excerpts their questions retrieved. Only six terms, so treat it as a first
 * setting; the 30 seed tickets were checked separately.
 */
export const TERM_MIN_SIMILARITY = 0.6;

/**
 * The terms the customer used that no help article mentions, by Postgres full-text search: English
 * stemming ("Calendars" finds "calendar"), and every word of a term must appear in the same text.
 *
 * Embeddings match on topic, so "pay a deposit in Bitcoin" lands on the deposits article. Exact
 * words don't: if no article ever says "Bitcoin", no article can answer a question about it.
 * Only terms that appear in the customer's own words count, so a word the model made up can't
 * discard a draft. A term made only of stop words ("the") carries nothing to look for.
 */
export async function notInHelpCentre(
  db: Db,
  terms: string[],
  question: string,
): Promise<string[]> {
  const unique = [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
  const missing: string[] = [];
  for (const term of unique) {
    const { rows } = await db.execute<{ missing: boolean }>(sql`
      select numnode(q.query) > 0
        and to_tsvector('english', ${question}) @@ q.query
        and not exists (
          select 1 from ${articles}
          where to_tsvector('english', ${articles.title} || ' ' || ${articles.body}) @@ q.query
        ) as missing
      from (select plainto_tsquery('english', ${term}) as query) q`);
    if (rows[0]?.missing) missing.push(term);
  }
  return missing;
}

export interface TermCheck {
  /** what the model says the customer asks about */
  terms: string[];
  /** the customer's own words: the ticket's subject and messages */
  question: string;
  /** the chunks the model was given */
  excerptHashes: string[];
  minSimilarity?: number;
}

/**
 * What the customer asked about that the excerpts given to the model don't cover: terms they used
 * that no article mentions by name, unless they are close in meaning to one of those excerpts.
 */
export async function uncoveredTerms(
  db: Db,
  embedder: Embedder,
  check: TermCheck,
): Promise<string[]> {
  const { terms, question, excerptHashes, minSimilarity = TERM_MIN_SIMILARITY } = check;
  const unnamed = await notInHelpCentre(db, terms, question);
  if (unnamed.length === 0 || excerptHashes.length === 0) return unnamed;
  const uncovered: string[] = [];
  for (const term of unnamed) {
    const vector = await embedder.embedQuery(term);
    const [row] = await db
      .select({ best: sql<number>`max(1 - (${cosineDistance(articleChunks.embedding, vector)}))` })
      .from(articleChunks)
      .where(inArray(articleChunks.contentHash, excerptHashes));
    if (Number(row?.best ?? 0) < minSimilarity) uncovered.push(term);
  }
  return uncovered;
}
