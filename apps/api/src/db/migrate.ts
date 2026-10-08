// Applies the SQL migrations in `apps/api/drizzle/` (generated base + hand-written constraints).
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export const migrateDatabase = async (connectionString: string): Promise<void> => {
  const db = createDb(connectionString);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await db.$client.end();
  }
};
