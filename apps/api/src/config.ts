import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const DEV_WEBHOOK_SECRET = 'dev-only-webhook-secret-change-me';

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.url().default('postgres://relay:relay@localhost:5433/relay'),
    WEBHOOK_SECRET: z.string().min(16).default(DEV_WEBHOOK_SECRET),
    WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    OLLAMA_URL: z.url().default('http://localhost:11434'),
    EMBED_MODEL: z.string().min(1).default('nomic-embed-text'),
    OLLAMA_CHAT_MODEL: z.string().min(1).default('qwen2.5:3b'),
    // CPU threads Ollama uses per request; unset lets Ollama decide (see docker-compose.yml)
    OLLAMA_NUM_THREAD: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.coerce.number().int().positive().optional(),
    ),
    // Optional. When set, Claude drafts the replies instead of the local model.
    ANTHROPIC_API_KEY: z
      .string()
      .optional()
      .transform((key) => key?.trim() || undefined),
    CLAUDE_MODEL: z.string().min(1).default('claude-opus-5-5'),
    SUGGESTION_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.65),
    HELP_CENTER_URL: z.url().default('https://help.slotwise.example/articles'),
    // Set in the Docker image: the API then also serves the built UI
    WEB_DIST: z.string().min(1).optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.WEBHOOK_SECRET !== DEV_WEBHOOK_SECRET, {
    message: 'Set a real WEBHOOK_SECRET in production',
    path: ['WEBHOOK_SECRET'],
  });

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  logLevel: string;
  webDist: string | undefined;
  webhook: { secret: string; toleranceSeconds: number };
  ai: {
    ollamaUrl: string;
    embedModel: string;
    ollamaChatModel: string;
    ollamaNumThread: number | undefined;
    anthropicApiKey: string | undefined;
    claudeModel: string;
    minSimilarity: number;
    helpCenterUrl: string;
  };
}

/** Reads `.env` at the repo root if there is one. Real environment variables win. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const envFile = resolve(import.meta.dirname, '../../../.env');
  if (source === process.env && existsSync(envFile)) process.loadEnvFile(envFile);

  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    logLevel: env.LOG_LEVEL,
    webDist: env.WEB_DIST,
    webhook: { secret: env.WEBHOOK_SECRET, toleranceSeconds: env.WEBHOOK_TOLERANCE_SECONDS },
    ai: {
      ollamaUrl: env.OLLAMA_URL.replace(/\/$/, ''),
      embedModel: env.EMBED_MODEL,
      ollamaChatModel: env.OLLAMA_CHAT_MODEL,
      ollamaNumThread: env.OLLAMA_NUM_THREAD,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      claudeModel: env.CLAUDE_MODEL,
      minSimilarity: env.SUGGESTION_MIN_SIMILARITY,
      helpCenterUrl: env.HELP_CENTER_URL.replace(/\/$/, ''),
    },
  };
}
