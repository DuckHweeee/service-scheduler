import { loadConfig } from '../src/config.js';
import { migrateDatabase } from '../src/db/migrate.js';

const { DATABASE_URL } = loadConfig();
await migrateDatabase(DATABASE_URL);
console.log('migrations applied');
