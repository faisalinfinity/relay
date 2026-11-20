/**
 * The two kinds of model Relay uses, as interfaces. Retrieval and drafting depend on these,
 * not on Ollama, so tests run with deterministic fakes and no model server.
 */

/** Turns text into a vector; similar meaning → nearby vectors. */
export interface Embedder {
  readonly model: string;
  /** for help-centre chunks being stored */
  embedDocuments(texts: string[]): Promise<number[][]>;
  /** for a ticket being searched with */
  embedQuery(text: string): Promise<number[]>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Writes text. Relay always asks for JSON matching a schema, so the answer can be checked. */
export interface ChatModel {
  readonly model: string;
  generateJson(messages: ChatMessage[], jsonSchema: object): Promise<string>;
}

/** The model server can't be reached, or the model isn't installed. Shown to agents as a 503. */
export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

/** The model answered, but with nothing Relay can use (declined, cut off, wrong shape). A 502. */
export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelOutputError';
  }
}
