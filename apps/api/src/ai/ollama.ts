import { ModelUnavailableError, type ChatMessage, type ChatModel, type Embedder } from './models';

/**
 * nomic-embed-text is trained with a task prefix on every input: "search_document: " for what
 * is stored and "search_query: " for what is searched with. Leaving them off quietly makes
 * retrieval worse.
 */
const NOMIC_PREFIXES = { document: 'search_document: ', query: 'search_query: ' };

const EMBED_BATCH = 32;

/**
 * How long Ollama keeps a model in memory after a request. Its default is 5 minutes, and loading
 * a model again can take far longer than drafting with it, so keep it warm through quiet spells.
 */
const KEEP_ALIVE = '1h';

async function post<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'is not reachable';
    throw new ModelUnavailableError(`The model server at ${baseUrl} ${reason}. Is Ollama running?`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    // Ollama answers 404 "model ... not found" when a model hasn't been pulled
    throw new ModelUnavailableError(
      response.status === 404
        ? `${text.trim() || 'Model not found'}. Run: pnpm models:pull`
        : `Ollama answered ${response.status}: ${text.slice(0, 200)}`,
    );
  }
  return (await response.json()) as T;
}

/** Ollama per-request options; `num_thread` caps the CPU threads it uses. */
export interface OllamaOptions {
  numThread?: number;
}

const runtimeOptions = ({ numThread }: OllamaOptions) =>
  numThread === undefined ? {} : { num_thread: numThread };

export function ollamaEmbedder(
  baseUrl: string,
  model: string,
  options: OllamaOptions = {},
): Embedder {
  const prefixes = model.startsWith('nomic-embed') ? NOMIC_PREFIXES : { document: '', query: '' };

  const embed = async (inputs: string[]): Promise<number[][]> => {
    const vectors: number[][] = [];
    for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
      const batch = inputs.slice(i, i + EMBED_BATCH);
      const { embeddings } = await post<{ embeddings: number[][] }>(
        baseUrl,
        '/api/embed',
        { model, input: batch, options: runtimeOptions(options), keep_alive: KEEP_ALIVE },
        60_000,
      );
      vectors.push(...embeddings);
    }
    return vectors;
  };

  return {
    model,
    embedDocuments: (texts) => embed(texts.map((text) => prefixes.document + text)),
    embedQuery: async (text) => (await embed([prefixes.query + text]))[0]!,
  };
}

export function ollamaChat(baseUrl: string, model: string, options: OllamaOptions = {}): ChatModel {
  return {
    model,
    async generateJson(messages: ChatMessage[], jsonSchema: object) {
      const { message } = await post<{ message: { content: string } }>(
        baseUrl,
        '/api/chat',
        {
          model,
          messages,
          stream: false,
          // Ollama constrains the output to this JSON schema
          format: jsonSchema,
          // Low temperature: a support reply should be faithful to the articles, not creative
          options: { temperature: 0.1, ...runtimeOptions(options) },
          keep_alive: KEEP_ALIVE,
        },
        180_000,
      );
      return message.content;
    },
  };
}

/** Loads a model into memory without generating anything, so the first real request is fast. */
export async function warmModel(
  baseUrl: string,
  model: string,
  kind: 'embed' | 'chat',
  options: OllamaOptions = {},
): Promise<void> {
  const common = { model, keep_alive: KEEP_ALIVE, options: runtimeOptions(options) };
  if (kind === 'embed')
    await post(baseUrl, '/api/embed', { ...common, input: 'warm up' }, 10 * 60_000);
  else await post(baseUrl, '/api/generate', { ...common, prompt: '' }, 10 * 60_000);
}

/** Asks Ollama to download a model if it doesn't have it yet. */
export async function pullModel(baseUrl: string, model: string): Promise<void> {
  await post(baseUrl, '/api/pull', { model, stream: false }, 30 * 60_000);
}
