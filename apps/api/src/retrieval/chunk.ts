import { createHash } from 'node:crypto';

export interface Chunk {
  ordinal: number;
  heading: string;
  /** the section text, as given to the chat model */
  content: string;
  /** what gets embedded: the article title and heading give the section its context */
  text: string;
}

/**
 * Help articles are written as one task per `##` section ("Error SW-1042", "Fees on refunds").
 * One chunk per section matches that: a whole article mixes several answers into one vector,
 * and single sentences lose the context that makes them findable ("Click Reconnect" means
 * nothing without "SW-1042" and "calendar"). Sections longer than MAX_WORDS are split at
 * paragraph breaks.
 */
export const MAX_WORDS = 220;

export function chunkArticle(article: { title: string; body: string }): Chunk[] {
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let current = { heading: 'Overview', lines: [] as string[] };
  for (const line of article.body.split('\n')) {
    if (/^# /.test(line)) continue; // the H1 repeats the title
    const h2 = /^## +(.+)$/.exec(line);
    if (h2) {
      sections.push(current);
      current = { heading: h2[1]!.trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const blocks = section.lines
      .join('\n')
      .split(/\n\s*\n/)
      .map((block) => plainLinks(block.trim()))
      .filter(Boolean);

    let group: string[] = [];
    let words = 0;
    const flush = () => {
      if (group.length === 0) return;
      const content = group.join('\n\n');
      chunks.push({
        ordinal: chunks.length,
        heading: section.heading,
        content,
        text: `${article.title}\n${section.heading}\n\n${content}`,
      });
      group = [];
      words = 0;
    };
    for (const block of blocks) {
      const count = block.split(/\s+/).length;
      if (words > 0 && words + count > MAX_WORDS) flush();
      group.push(block);
      words += count;
    }
    flush();
  }
  return chunks;
}

/** Changes whenever the embedded text or the embedding model changes. */
export function chunkHash(embeddingModel: string, text: string): string {
  return createHash('sha256').update(`${embeddingModel}\n${text}`).digest('hex');
}

/** "[Time zones](03-time-zones.md)" → "Time zones": file names are noise to an embedding. */
function plainLinks(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
