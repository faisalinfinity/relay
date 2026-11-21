import type { Config } from '../config';
import { claudeChat } from './claude';
import type { ChatModel, Embedder } from './models';
import { ollamaChat, ollamaEmbedder } from './ollama';

/**
 * Embeddings always come from Ollama (local, no key). Drafting uses Claude when an API key is
 * configured, and the local Ollama model otherwise, so Relay runs with no keys at all.
 */
export function createModels(ai: Config['ai']): { embedder: Embedder; chat: ChatModel } {
  const ollama = { numThread: ai.ollamaNumThread };
  return {
    embedder: ollamaEmbedder(ai.ollamaUrl, ai.embedModel, ollama),
    chat: ai.anthropicApiKey
      ? claudeChat(ai.anthropicApiKey, ai.claudeModel)
      : ollamaChat(ai.ollamaUrl, ai.ollamaChatModel, ollama),
  };
}
