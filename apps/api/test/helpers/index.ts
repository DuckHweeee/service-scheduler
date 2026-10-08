/**
 * Shared test helpers (W2 agents: this is how you get a real database and an app).
 *
 *   import { createTestDb, seedReference, buildTestApp } from '../helpers/index.js';
 *
 *   let t: TestDb;
 *   beforeAll(async () => { t = await createTestDb(); await seedReference(t.db); });
 *   afterAll(() => t.cleanup());
 *
 *   const app = await buildTestApp({ db: t.db, clock: fixedClock('2026-10-08T09:10:00+07:00') });
 *   const res = await app.inject({ method: 'GET', url: '/health/ready' });
 *
 * - vitest's globalSetup (test/helpers/global-setup.ts, wired in vitest.config.ts) starts one ephemeral embedded
 *   Postgres per test run on a free random port and migrates a template database. Set TEST_DATABASE_URL to use an
 *   external server instead.
 * - `createTestDb()` clones that template (`CREATE DATABASE … TEMPLATE …`), so every test FILE gets an isolated,
 *   migrated, EMPTY database. Call `seedReference(db)` for SPEC §7 reference data (no background appointments).
 * - `cleanup()` closes the pool and drops the database; call it in `afterAll`.
 * - Never mock the database in integration tests (CLAUDE.md rule 7).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { inject } from 'vitest';
import { buildApp, type AppDeps } from '../../src/app.js';
import { createDb, type Db } from '../../src/db/client.js';
import { seedReferenceData } from '../../src/db/seed/reference.js';
import { withDatabase } from './url.js';

export interface TestDb {
  db: Db;
  url: string;
  cleanup: () => Promise<void>;
}

export const createTestDb = async (): Promise<TestDb> => {
  const adminUrl = inject('pgAdminUrl');
  const template = inject('pgTemplate');
  const name = `t_${randomUUID().replaceAll('-', '').slice(0, 16)}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
  } finally {
    await admin.end();
  }

  const url = withDatabase(adminUrl, name);
  const db = createDb(url);
  return {
    db,
    url,
    cleanup: async () => {
      await db.$client.end();
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      try {
        await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await c.end();
      }
    },
  };
};

/** SPEC §7 reference data: dealerships, bays, technicians, services, parts, inventory, customers, vehicles. */
export const seedReference = (db: Db): Promise<void> => seedReferenceData(db);

export const buildTestApp = (deps: Pick<AppDeps, 'db' | 'clock'> & Partial<AppDeps>): Promise<FastifyInstance> =>
  buildApp(deps);
