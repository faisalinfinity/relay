import pg from 'pg';
import { runMigrations } from '../src/db/migrate';
import { TEST_DATABASE_URL } from './env';

/** Creates the test database on first run, then brings its schema up to date. */
export default async function setup() {
  await ensureDatabaseExists(TEST_DATABASE_URL);
  await runMigrations(TEST_DATABASE_URL);
}

async function ensureDatabaseExists(url: string) {
  const name = new URL(url).pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';

  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (!rowCount) await client.query(`create database "${name.replaceAll('"', '""')}"`);
  } finally {
    await client.end();
  }
}
