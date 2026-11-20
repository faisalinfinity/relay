import { describe, expect, it } from 'vitest';
import { chunkArticle, chunkHash, MAX_WORDS } from '../src/retrieval/chunk';

const article = {
  title: 'Refunding a client',
  body: `# Refunding a client

Short intro paragraph.

## Issue a refund

1. Open the booking.
2. Click **Refund**. See [Payment errors](13-payment-errors.md).

## How long it takes

Banks take 5 to 10 business days.`,
};

describe('chunkArticle', () => {
  it('makes one chunk per section, with the title and heading as context', () => {
    const chunks = chunkArticle(article);

    expect(chunks.map((c) => c.heading)).toEqual([
      'Overview',
      'Issue a refund',
      'How long it takes',
    ]);
    expect(chunks[2]!.text).toBe(
      'Refunding a client\nHow long it takes\n\nBanks take 5 to 10 business days.',
    );
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2]);
  });

  it('drops the H1 and keeps link text without the file name', () => {
    const [overview, issue] = chunkArticle(article);
    expect(overview!.content).toBe('Short intro paragraph.');
    expect(issue!.content).toContain('See Payment errors.');
    expect(issue!.content).not.toContain('.md');
  });

  it('splits a long section at paragraph breaks', () => {
    const paragraph = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const long = { title: 'T', body: `## Long\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}` };

    const chunks = chunkArticle(long);

    expect(chunks.length).toBe(3);
    for (const chunk of chunks) {
      expect(chunk.content.split(/\s+/).length).toBeLessThanOrEqual(MAX_WORDS);
      expect(chunk.heading).toBe('Long');
    }
  });

  it('skips empty sections', () => {
    expect(chunkArticle({ title: 'T', body: '# T\n\n## Empty\n\n## Full\n\nText' })).toHaveLength(
      1,
    );
  });
});

describe('chunkHash', () => {
  it('changes with the text and with the embedding model', () => {
    const base = chunkHash('model-a', 'text');
    expect(chunkHash('model-a', 'text')).toBe(base);
    expect(chunkHash('model-a', 'text!')).not.toBe(base);
    expect(chunkHash('model-b', 'text')).not.toBe(base);
  });
});
