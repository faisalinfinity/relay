import { loadConfig } from '../src/config';
import { runMigrations } from '../src/db/migrate';

const config = loadConfig();
await runMigrations(config.databaseUrl);
console.log('Migrations applied.');
