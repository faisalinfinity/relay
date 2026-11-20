import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import { pino, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { sql } from 'drizzle-orm';
import { agentsRouter } from './agents/routes';
import type { Db } from './db/client';
import { loadAgent } from './http/agent';
import { suggestionsRouter } from './suggestions/routes';
import type { SuggestionService } from './suggestions/service';
import { errorHandler, notFoundHandler } from './http/errors';
import { ticketsRouter } from './tickets/routes';
import { webhooksRouter, type WebhookOptions } from './webhooks/routes';

export interface AppDeps {
  db: Db;
  webhook: WebhookOptions;
  suggestions: SuggestionService;
  logger?: Logger;
}

export function createApp({ db, webhook, suggestions, logger = pino() }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
    }),
  );

  app.get('/health', async (_req, res) => {
    await db.execute(sql`select 1`);
    res.json({ data: { ok: true } });
  });

  // Mounted before express.json(): the webhook has to see the raw bytes to check the HMAC.
  app.use('/webhooks', webhooksRouter(db, webhook));

  app.use(express.json({ limit: '100kb' }));
  app.use('/api', loadAgent(db));
  app.use('/api/agents', agentsRouter(db));
  app.use('/api/tickets', ticketsRouter(db));
  app.use('/api/tickets', suggestionsRouter(suggestions));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
