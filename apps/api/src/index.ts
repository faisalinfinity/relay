import { pino } from 'pino';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';

const config = loadConfig();
const logger = pino({ level: config.logLevel });
const { db, pool } = createDb(config.databaseUrl);

const app = createApp({ db, webhook: config.webhook, logger });

const server = app.listen(config.port, (error) => {
  if (error) {
    logger.fatal({ err: error }, 'could not start the API');
    process.exit(1);
  }
  logger.info(`Relay API listening on http://localhost:${config.port}`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
