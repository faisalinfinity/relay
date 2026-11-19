import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { inArray, sql } from 'drizzle-orm';
import matter from 'gray-matter';
import { z } from 'zod';
import type { Db } from '../db/client';
import { articles } from '../db/schema';

export const ARTICLES_DIR = resolve(import.meta.dirname, '../../../../content/articles');

const FrontMatter = z.object({ title: z.string().min(1), category: z.string().min(1) });

export interface ArticleFile {
  slug: string;
  title: string;
  category: string;
  body: string;
  contentHash: string;
}

/** Reads every `NN-slug.md` help article. The slug drops the ordering prefix. */
export async function loadArticleFiles(dir = ARTICLES_DIR): Promise<ArticleFile[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.md')).sort();
  return Promise.all(
    files.map(async (file) => {
      const raw = await readFile(join(dir, file), 'utf8');
      const { data, content } = matter(raw);
      const meta = FrontMatter.safeParse(data);
      if (!meta.success)
        throw new Error(`${file}: bad front matter\n${z.prettifyError(meta.error)}`);
      return {
        slug: basename(file, '.md').replace(/^\d+-/, ''),
        title: meta.data.title,
        category: meta.data.category,
        body: content.trim(),
        contentHash: createHash('sha256').update(raw).digest('hex'),
      };
    }),
  );
}

export interface SyncReport {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: number;
}

/**
 * Makes the articles table match the files. Only writes rows whose content hash changed,
 * so later steps (chunking, embedding) can work on just what changed.
 */
export async function syncArticles(db: Db, files: ArticleFile[]): Promise<SyncReport> {
  const existing = await db
    .select({ slug: articles.slug, contentHash: articles.contentHash })
    .from(articles);
  const known = new Map(existing.map((row) => [row.slug, row.contentHash]));
  const onDisk = new Set(files.map((file) => file.slug));

  const changed = files.filter((file) => known.get(file.slug) !== file.contentHash);
  const removed = existing.filter((row) => !onDisk.has(row.slug)).map((row) => row.slug);

  await db.transaction(async (tx) => {
    for (const file of changed) {
      await tx
        .insert(articles)
        .values(file)
        .onConflictDoUpdate({
          target: articles.slug,
          set: {
            title: file.title,
            category: file.category,
            body: file.body,
            contentHash: file.contentHash,
            updatedAt: sql`now()`,
          },
        });
    }
    if (removed.length > 0) await tx.delete(articles).where(inArray(articles.slug, removed));
  });

  return {
    added: changed.filter((file) => !known.has(file.slug)).map((file) => file.slug),
    updated: changed.filter((file) => known.has(file.slug)).map((file) => file.slug),
    removed,
    unchanged: files.length - changed.length,
  };
}
