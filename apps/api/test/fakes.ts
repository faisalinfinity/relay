import { createHash } from 'node:crypto';
import type { ChatMessage, ChatModel, Embedder } from '../src/ai/models';
import { EMBEDDING_DIMENSIONS } from '../src/db/schema';

/**
 * A deterministic stand-in for the embedding model: each word adds to one of 768 buckets
 * ("feature hashing"), so texts that share words point in similar directions. Good enough
 * to test retrieval plumbing without a model server.
 */
export class FakeEmbedder implements Embedder {
  readonly model: string;
  readonly embedded: string[] = [];

  constructor(model = 'fake-embed') {
    this.model = model;
  }

  embedDocuments(texts: string[]) {
    this.embedded.push(...texts);
    return Promise.resolve(texts.map(vectorFor));
  }

  embedQuery(text: string) {
    return Promise.resolve(vectorFor(text));
  }
}

export function vectorFor(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? []) {
    const bucket = createHash('md5').update(word).digest().readUInt32BE(0) % EMBEDDING_DIMENSIONS;
    vector[bucket]! += 1;
  }
  const length = Math.hypot(...vector) || 1;
  return vector.map((v) => v / length);
}

/** A chat model that answers with whatever `respond` returns, and remembers what it was asked. */
export class FakeChat implements ChatModel {
  readonly model = 'fake-chat';
  readonly calls: ChatMessage[][] = [];

  constructor(public respond: (messages: ChatMessage[]) => string | Promise<string>) {}

  async generateJson(messages: ChatMessage[]) {
    this.calls.push(messages);
    return this.respond(messages);
  }
}

export const answer = (
  reply: string,
  citations: number[],
  answeredBy = citations[0] ?? 1,
  asksAbout: string[] = [],
) => JSON.stringify({ asksAbout, answeredBy, reply, citations });

export const decline = () =>
  JSON.stringify({ asksAbout: [], answeredBy: 0, reply: '', citations: [] });
