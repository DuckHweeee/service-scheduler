// Vitest globalSetup: starts an EPHEMERAL embedded Postgres on a free random port (several agents run suites
// concurrently), migrates a template database once, and `provide`s the connection info to test files.
// Set TEST_DATABASE_URL to reuse an existing server instead (the URL must point at any database on it).
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { findFreePort, startEmbedded, type EmbeddedInstance } from '../../src/db/embedded.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { withDatabase } from './url.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection string to a maintenance database on the test server (used for CREATE DATABASE). */
    pgAdminUrl: string;
    /** Name of the migrated template database. */
    pgTemplate: string;
  }
}

export default async function setup(project: TestProject) {
  let embedded: EmbeddedInstance | undefined;
  let adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'scheduler-pgtest-'));
    embedded = await startEmbedded({ dataDir, port: await findFreePort(), persistent: false, quiet: true });
    adminUrl = embedded.adminUrl;
  }

  const template = `scheduler_tpl_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${template}"`);
  await admin.end();
  await migrateDatabase(withDatabase(adminUrl, template));

  project.provide('pgAdminUrl', adminUrl);
  project.provide('pgTemplate', template);

  return async () => {
    if (embedded) {
      await embedded.stop();
    } else {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`);
      await c.end();
    }
  };
}
