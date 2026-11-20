import { asc, cosineDistance, eq, sql } from 'drizzle-orm';
import type { Embedder } from '../ai/models';
import type { Db } from '../db/client';
import { articleChunks, articles } from '../db/schema';

export interface ChunkHit {
  chunkId: string;
  contentHash: string;
  slug: string;
  title: string;
  heading: string;
  content: string;
  /** cosine similarity, 1 = same direction, 0 = unrelated */
  similarity: number;
}

/** The `limit` chunks nearest to `vector`, most similar first. Uses the HNSW index. */
export async function nearestChunks(db: Db, vector: number[], limit: number): Promise<ChunkHit[]> {
  const distance = cosineDistance(articleChunks.embedding, vector);
  return db
    .select({
      chunkId: articleChunks.id,
      contentHash: articleChunks.contentHash,
      slug: articles.slug,
      title: articles.title,
      heading: articleChunks.heading,
      content: articleChunks.content,
      similarity: sql<number>`1 - (${distance})`.mapWith(Number),
    })
    .from(articleChunks)
    .innerJoin(articles, eq(articles.id, articleChunks.articleId))
    .orderBy(asc(distance))
    .limit(limit);
}

export interface Retrieval {
  /** everything the search returned, for showing the agent what was considered */
  hits: ChunkHit[];
  /** the hits that cleared the cut-off; empty means no article covers the question */
  relevant: ChunkHit[];
}

/**
 * The embedding step: turn the question into a vector and find the nearest help-centre chunks.
 * Only chunks at or above `minSimilarity` count as relevant (see README for how it was chosen).
 */
export async function retrieve(
  db: Db,
  embedder: Embedder,
  question: string,
  options: { limit: number; minSimilarity: number },
): Promise<Retrieval> {
  const vector = await embedder.embedQuery(question);
  const hits = await nearestChunks(db, vector, options.limit);
  return { hits, relevant: hits.filter((hit) => hit.similarity >= options.minSimilarity) };
}
