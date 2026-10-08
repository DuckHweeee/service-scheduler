// Wave 0 placeholder — A1 owns src/db/** and replaces this with the real drizzle client + schema.
// Keep the exported names: `Db`, `DbOrTx`, `createDb`.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export const createDb = (connectionString: string): Db => {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema }) as Db;
};
