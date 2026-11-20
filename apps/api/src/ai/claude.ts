import Anthropic from '@anthropic-ai/sdk';
import {
  ModelOutputError,
  ModelUnavailableError,
  type ChatMessage,
  type ChatModel,
} from './models';

/**
 * Claude as the drafting model, used when ANTHROPIC_API_KEY is set. Embeddings stay on Ollama:
 * Anthropic has no embeddings API.
 */
export function claudeChat(apiKey: string, model: string): ChatModel {
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });

  return {
    model,
    async generateJson(messages: ChatMessage[], jsonSchema: object) {
      const system = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const turns = messages
        .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }));

      let response;
      try {
        response = await client.beta.messages.create({
          model,
          max_tokens: 16_000,
          system,
          messages: turns,
          output_config: {
            // A short, faithful support reply doesn't need deep reasoning
            effort: 'low',
            // The answer is constrained to the same JSON schema the local model gets
            format: { type: 'json_schema', schema: jsonSchema as Record<string, unknown> },
          },
          // If a safety classifier declines, retry on Anthropic's recommended fallback model
          // within the same call, instead of failing the suggestion.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
      } catch (error) {
        throw toUnavailable(error);
      }

      if (response.stop_reason === 'refusal') {
        throw new ModelOutputError('Claude declined to draft a reply for this ticket.');
      }
      if (response.stop_reason === 'max_tokens') {
        throw new ModelOutputError('The draft was cut off before it was finished.');
      }
      return response.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    },
  };
}

/** Errors that mean "drafting isn't possible right now" become a 503 for the agent. */
function toUnavailable(error: unknown): unknown {
  // APIConnectionError (including timeouts) is a subclass of APIError: check it first
  if (error instanceof Anthropic.APIConnectionError) {
    return new ModelUnavailableError('Could not reach the Claude API.');
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new ModelUnavailableError('The Claude API rejected ANTHROPIC_API_KEY.');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ModelUnavailableError('The Claude API is rate limiting Relay. Try again shortly.');
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new ModelUnavailableError('The Claude API is having trouble. Try again shortly.');
  }
  return error; // anything else (e.g. a 400) is a bug in Relay: let it surface as a 500
}
