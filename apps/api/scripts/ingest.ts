/**
 * Splits the help articles into chunks, embeds them and stores the vectors in pgvector.
 * Safe to run any time: only chunks whose text (or the embedding model) changed are embedded.
 */
import { createModels } from '../src/ai';
import { loadConfig } from '../src/config';
import { createDb } from '../src/db/client';
import { ingestArticles } from '../src/retrieval/ingest';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const { embedder } = createModels(config.ai);

try {
  const started = Date.now();
  const report = await ingestArticles(db, embedder);
  const { added, updated, removed } = report.articles;
  console.log(
    `Articles: ${added.length} added, ${updated.length} changed, ${removed.length} removed` +
      (updated.length ? ` (${updated.join(', ')})` : ''),
  );
  console.log(
    `Chunks: ${report.embedded} embedded with ${embedder.model}, ${report.kept} unchanged, ` +
      `${report.removed} removed, in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
} finally {
  await pool.end();
}
