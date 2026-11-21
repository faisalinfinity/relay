/**
 * Everything a fresh environment needs before the API starts, safe to run on every start:
 * migrate, seed the demo data if the database is empty, download the models, ingest articles.
 * Used by `docker compose up`.
 */
import { count } from 'drizzle-orm';
import { seedDatabase } from '../seed/seed';
import { createModels } from '../src/ai';
import { pullModel, warmModel } from '../src/ai/ollama';
import { loadConfig } from '../src/config';
import { createDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { agents } from '../src/db/schema';
import { ingestArticles } from '../src/retrieval/ingest';

const config = loadConfig();
const log = (message: string) => console.log(`[bootstrap] ${message}`);

await runMigrations(config.databaseUrl);
log('migrations applied');

const { db, pool } = createDb(config.databaseUrl);
try {
  const [{ agentCount } = { agentCount: 0 }] = await db
    .select({ agentCount: count() })
    .from(agents);
  if (agentCount === 0) {
    await seedDatabase(db);
    log('empty database: seeded 4 agents and 30 tickets');
  } else {
    log('database already has data: not seeding');
  }

  const { ai } = config;
  for (const model of [ai.embedModel, ...(ai.anthropicApiKey ? [] : [ai.ollamaChatModel])]) {
    log(`making sure Ollama has ${model} (the first run downloads it, which takes a few minutes)`);
    await pullModel(ai.ollamaUrl, model);
  }

  const report = await ingestArticles(db, createModels(ai).embedder);
  log(`articles ingested: ${report.embedded} chunks embedded, ${report.kept} unchanged`);

  // Loading a model can take much longer than using it (minutes on a CPU in Docker), so pay that
  // here rather than on an agent's first click
  const started = Date.now();
  const options = { numThread: ai.ollamaNumThread };
  await warmModel(ai.ollamaUrl, ai.embedModel, 'embed', options);
  if (!ai.anthropicApiKey) await warmModel(ai.ollamaUrl, ai.ollamaChatModel, 'chat', options);
  log(`models loaded into memory in ${Math.round((Date.now() - started) / 1000)}s`);
} finally {
  await pool.end();
}
