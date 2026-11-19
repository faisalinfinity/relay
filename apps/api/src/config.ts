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
  webhook: { secret: string; toleranceSeconds: number };
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
    webhook: { secret: env.WEBHOOK_SECRET, toleranceSeconds: env.WEBHOOK_TOLERANCE_SECONDS },
  };
}
