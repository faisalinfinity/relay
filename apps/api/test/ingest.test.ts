import { createHash } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ArticleFile } from '../src/articles/sync';
import { createDb } from '../src/db/client';
import { articleChunks, articles } from '../src/db/schema';
import { ingestArticles } from '../src/retrieval/ingest';
import { retrieve } from '../src/retrieval/search';
import { TEST_DATABASE_URL } from './env';
import { FakeEmbedder } from './fakes';
import { resetDb } from './helpers';

const { db, pool } = createDb(TEST_DATABASE_URL);

afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetDb(db);
});

function file(slug: string, title: string, body: string): ArticleFile {
  return {
    slug,
    title,
    category: 'Test',
    body,
    contentHash: createHash('sha256')
      .update(title + body)
      .digest('hex'),
  };
}

const refunds = file(
  'refunding-a-client',
  'Refunding a client',
  '## Issue a refund\n\nOpen the booking and click Refund.\n\n## How long it takes\n\nBanks take 5 to 10 business days to show a refund.',
);
const calendar = file(
  'calendar-sync',
  'Calendar sync troubleshooting',
  '## Error SW-1042\n\nYour Google calendar connection expired. Click Reconnect.\n\n## Duplicates\n\nRemove the iCal feed subscription.',
);

describe('ingestArticles', () => {
  it('embeds every chunk the first time, and nothing when re-run unchanged', async () => {
    const embedder = new FakeEmbedder();

    const first = await ingestArticles(db, embedder, [refunds, calendar]);
    const second = await ingestArticles(db, embedder, [refunds, calendar]);

    expect(first).toMatchObject({ embedded: 4, kept: 0, removed: 0 });
    expect(second).toMatchObject({ embedded: 0, kept: 4, removed: 0 });
    expect(embedder.embedded).toHaveLength(4);
  });

  it('re-embeds only the section that changed when one article is edited', async () => {
    const embedder = new FakeEmbedder();
    await ingestArticles(db, embedder, [refunds, calendar]);
    embedder.embedded.length = 0;

    const edited = file(
      refunds.slug,
      refunds.title,
      refunds.body.replace('5 to 10 business days', '3 to 5 business days'),
    );
    const report = await ingestArticles(db, embedder, [edited, calendar]);

    expect(report).toMatchObject({ embedded: 1, kept: 3, removed: 1 });
    expect(report.articles.updated).toEqual(['refunding-a-client']);
    expect(embedder.embedded).toEqual([
      'Refunding a client\nHow long it takes\n\nBanks take 3 to 5 business days to show a refund.',
    ]);
  });

  it('keeps a section untouched when a new section is added above it, updating its position', async () => {
    const embedder = new FakeEmbedder();
    await ingestArticles(db, embedder, [refunds]);
    embedder.embedded.length = 0;

    const withIntro = file(
      refunds.slug,
      refunds.title,
      `## Before you start\n\nCheck the payment.\n\n${refunds.body}`,
    );
    const report = await ingestArticles(db, embedder, [withIntro]);

    expect(report).toMatchObject({ embedded: 1, kept: 2, removed: 0 });
    const rows = await db
      .select({ heading: articleChunks.heading, ordinal: articleChunks.ordinal })
      .from(articleChunks)
      .orderBy(asc(articleChunks.ordinal));
    expect(rows.map((r) => r.heading)).toEqual([
      'Before you start',
      'Issue a refund',
      'How long it takes',
    ]);
  });

  it('removes the chunks of a deleted article', async () => {
    const embedder = new FakeEmbedder();
    await ingestArticles(db, embedder, [refunds, calendar]);

    const report = await ingestArticles(db, embedder, [refunds]);

    expect(report.articles.removed).toEqual(['calendar-sync']);
    expect(await db.select().from(articles).where(eq(articles.slug, 'calendar-sync'))).toEqual([]);
    expect(await db.select().from(articleChunks)).toHaveLength(2);
  });

  it('re-embeds everything when the embedding model changes', async () => {
    await ingestArticles(db, new FakeEmbedder('model-a'), [refunds, calendar]);
    const report = await ingestArticles(db, new FakeEmbedder('model-b'), [refunds, calendar]);
    expect(report).toMatchObject({ embedded: 4, kept: 0, removed: 4 });
  });
});

describe('retrieve', () => {
  it('finds the nearest section and applies the cut-off', async () => {
    const embedder = new FakeEmbedder();
    await ingestArticles(db, embedder, [refunds, calendar]);

    const found = await retrieve(
      db,
      embedder,
      'google calendar connection expired SW-1042 reconnect',
      {
        limit: 3,
        minSimilarity: 0.3,
      },
    );
    const nothing = await retrieve(db, embedder, 'do you sell gift vouchers', {
      limit: 3,
      minSimilarity: 0.3,
    });

    expect(found.hits[0]).toMatchObject({ slug: 'calendar-sync', heading: 'Error SW-1042' });
    expect(found.relevant.length).toBeGreaterThan(0);
    expect(found.hits.map((h) => h.similarity)).toEqual(
      [...found.hits.map((h) => h.similarity)].sort((a, b) => b - a),
    );
    expect(nothing.hits.length).toBeGreaterThan(0); // something is always nearest...
    expect(nothing.relevant).toEqual([]); // ...but nothing is close enough to count
  });
});
