import { pino } from 'pino';
import { createModels } from './ai';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { pruneEvents } from './realtime/events';
import { RealtimeHub } from './realtime/hub';
import { EventRelay } from './realtime/relay';
import { createSuggestionService } from './suggestions/service';

/** Events older than this are deleted; a browser away for longer refetches instead of replaying. */
const EVENT_RETENTION_HOURS = 24;

const config = loadConfig();
const logger = pino({ level: config.logLevel });
const { db, pool } = createDb(config.databaseUrl);

const relay = new EventRelay(db, config.databaseUrl, logger);
await relay.start();

const { embedder, chat } = createModels(config.ai);
logger.info(`Suggested replies: embeddings by ${embedder.model}, drafts by ${chat.model}`);
const suggestions = createSuggestionService({
  db,
  embedder,
  chat,
  minSimilarity: config.ai.minSimilarity,
  helpCenterUrl: config.ai.helpCenterUrl,
});

const app = createApp({ db, webhook: config.webhook, suggestions, logger });

const server = app.listen(config.port, (error) => {
  if (error) {
    logger.fatal({ err: error }, 'could not start the API');
    process.exit(1);
  }
  logger.info(`Relay API listening on http://localhost:${config.port}`);
});
const hub = new RealtimeHub(server, { db, relay, logger });

const pruning = setInterval(
  () => {
    pruneEvents(db, EVENT_RETENTION_HOURS).catch((err: unknown) =>
      logger.error({ err }, 'pruning events failed'),
    );
  },
  60 * 60 * 1000,
);
pruning.unref();

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  clearInterval(pruning);
  hub.close();
  server.close(() => {
    void relay
      .stop()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
