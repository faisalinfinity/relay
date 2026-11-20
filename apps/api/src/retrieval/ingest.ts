import { eq, inArray } from 'drizzle-orm';
import type { Embedder } from '../ai/models';
import {
  loadArticleFiles,
  syncArticles,
  type ArticleFile,
  type SyncReport,
} from '../articles/sync';
import type { Db } from '../db/client';
import { articleChunks, articles } from '../db/schema';
import { chunkArticle, chunkHash } from './chunk';

export interface IngestReport {
  articles: SyncReport;
  /** chunks sent to the embedding model this run */
  embedded: number;
  /** chunks whose text and model were unchanged, so their stored vectors were kept */
  kept: number;
  removed: number;
}

/**
 * Brings article_chunks in line with content/articles, embedding only what changed.
 *
 * Every chunk is identified by a hash of the exact text that gets embedded plus the model name.
 * Editing one section of one article changes one hash, so one chunk is embedded. Switching the
 * embedding model changes every hash, so everything is embedded again.
 */
export async function ingestArticles(
  db: Db,
  embedder: Embedder,
  files?: ArticleFile[],
): Promise<IngestReport> {
  const articleReport = await syncArticles(db, files ?? (await loadArticleFiles()));

  const rows = await db
    .select({ id: articles.id, title: articles.title, body: articles.body })
    .from(articles);
  const wanted = rows.flatMap((article) =>
    chunkArticle(article).map((chunk) => ({
      ...chunk,
      articleId: article.id,
      contentHash: chunkHash(embedder.model, chunk.text),
    })),
  );

  const existing = await db
    .select({
      id: articleChunks.id,
      articleId: articleChunks.articleId,
      contentHash: articleChunks.contentHash,
      ordinal: articleChunks.ordinal,
    })
    .from(articleChunks);
  const key = (c: { articleId: string; contentHash: string }) => `${c.articleId}:${c.contentHash}`;
  const existingByKey = new Map(existing.map((c) => [key(c), c]));
  const wantedKeys = new Set(wanted.map(key));

  const toEmbed = wanted.filter((c) => !existingByKey.has(key(c)));
  const toDelete = existing.filter((c) => !wantedKeys.has(key(c)));
  const moved = wanted.filter((c) => {
    const kept = existingByKey.get(key(c));
    return kept !== undefined && kept.ordinal !== c.ordinal;
  });

  // Embed before opening the transaction: it's the slow part and needs no locks
  const vectors =
    toEmbed.length > 0 ? await embedder.embedDocuments(toEmbed.map((c) => c.text)) : [];

  await db.transaction(async (tx) => {
    if (toDelete.length > 0) {
      await tx.delete(articleChunks).where(
        inArray(
          articleChunks.id,
          toDelete.map((c) => c.id),
        ),
      );
    }
    if (toEmbed.length > 0) {
      await tx.insert(articleChunks).values(
        toEmbed.map((c, i) => ({
          articleId: c.articleId,
          ordinal: c.ordinal,
          heading: c.heading,
          content: c.content,
          contentHash: c.contentHash,
          embeddingModel: embedder.model,
          embedding: vectors[i]!,
        })),
      );
    }
    // A section added above an unchanged one shifts its position but not its text
    for (const c of moved) {
      await tx
        .update(articleChunks)
        .set({ ordinal: c.ordinal })
        .where(eq(articleChunks.id, existingByKey.get(key(c))!.id));
    }
  });

  return {
    articles: articleReport,
    embedded: toEmbed.length,
    kept: wanted.length - toEmbed.length,
    removed: toDelete.length,
  };
}
