import { seedAgents, seedTickets } from '../seed/data';
import { seedDatabase } from '../seed/seed';
import { loadArticleFiles, syncArticles } from '../src/articles/sync';
import { loadConfig } from '../src/config';
import { createDb } from '../src/db/client';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);

try {
  await seedDatabase(db);
  const report = await syncArticles(db, await loadArticleFiles());

  console.log(`Seeded ${seedAgents.length} agents and ${seedTickets.length} tickets.`);
  console.log(
    `Articles: ${report.added.length} added, ${report.updated.length} updated, ` +
      `${report.removed.length} removed, ${report.unchanged} unchanged.`,
  );
} finally {
  await pool.end();
}
