// Persistent embedded Postgres for local dev: data in <repo>/.pgdata, port 54329, postgres/postgres, db `scheduler`.
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { startEmbedded } from '../src/db/embedded.js';

const PORT = 54329;
const dataDir = fileURLToPath(new URL('../../../.pgdata', import.meta.url));

const instance = await startEmbedded({ dataDir, port: PORT, persistent: true });

const admin = new pg.Client({ connectionString: instance.adminUrl });
await admin.connect();
const exists = await admin.query('select 1 from pg_database where datname = $1', ['scheduler']);
if (exists.rowCount === 0) await admin.query('CREATE DATABASE scheduler');
await admin.end();

console.log(`Postgres ready: ${instance.urlFor('scheduler')}  (Ctrl-C to stop)`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log('stopping Postgres…');
  await instance.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30); // stay in the foreground
