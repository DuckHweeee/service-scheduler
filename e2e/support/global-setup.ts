import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixedClock } from '../../apps/api/src/clock.js';
import { createDb } from '../../apps/api/src/db/client.js';
import { findFreePort, startEmbedded } from '../../apps/api/src/db/embedded.js';
import { migrateDatabase } from '../../apps/api/src/db/migrate.js';
import {
  mulberry32,
  resetDatabase,
  seedBackgroundLoad,
  seedReferenceData,
} from '../../apps/api/src/db/seed/index.js';
import { CLOCK_OVERRIDE } from './constants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function waitFor(url: string, what: string, children: ChildProcess[], timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const c of children) {
      if (c.exitCode !== null) throw new Error(`${what}: a child process exited early (code ${c.exitCode})`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what} at ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

function start(name: string, cwd: string, args: string[], env: Record<string, string>): ChildProcess {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tail: string[] = [];
  const keep = (b: Buffer) => {
    tail.push(...b.toString().split('\n'));
    tail.splice(0, Math.max(0, tail.length - 40));
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  child.on('exit', (code) => {
    if (code !== null && code !== 0 && code !== 143) {
      console.error(`[e2e] ${name} exited with ${code}\n${tail.join('\n')}`);
    }
  });
  return child;
}

const stop = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
  });

/** Ephemeral Postgres + migrated/seeded DB + API (pinned clock) + Vite (real-API mode) on free ports. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const [pgPort, apiPort, webPort] = await Promise.all([findFreePort(), findFreePort(), findFreePort()]);
  const dataDir = mkdtempSync(path.join(tmpdir(), 'scheduler-e2e-pg-'));
  const children: ChildProcess[] = [];
  const pg = await startEmbedded({ dataDir, port: pgPort, persistent: false, quiet: true });

  const teardown = async () => {
    await Promise.all(children.map(stop));
    await pg.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    await pg.pg.createDatabase('scheduler');
    const databaseUrl = pg.urlFor('scheduler');
    await migrateDatabase(databaseUrl);
    const db = createDb(databaseUrl);
    try {
      await resetDatabase(db);
      await seedReferenceData(db);
      await seedBackgroundLoad(db, { clock: fixedClock(CLOCK_OVERRIDE), rng: mulberry32(42) });
    } finally {
      await db.$client.end();
    }

    const webUrl = `http://localhost:${webPort}`;
    const apiUrl = `http://localhost:${apiPort}`;
    children.push(
      start('api', path.join(root, 'apps/api'), ['--import', 'tsx', 'src/server.ts'], {
        PORT: String(apiPort),
        DATABASE_URL: databaseUrl,
        CLOCK_OVERRIDE,
        CORS_ORIGIN: webUrl,
        LOG_LEVEL: 'silent',
        NODE_ENV: 'development',
      }),
      start(
        'web',
        path.join(root, 'apps/web'),
        ['node_modules/vite/bin/vite.js', '--port', String(webPort), '--strictPort', '--host', 'localhost'],
        { VITE_USE_MOCKS: 'false', VITE_API_URL: apiUrl },
      ),
    );
    await waitFor(`${apiUrl}/health/ready`, 'API', children);
    await waitFor(webUrl, 'web', children);

    process.env.E2E_WEB_URL = webUrl;
    process.env.E2E_API_URL = apiUrl;
  } catch (err) {
    await teardown();
    throw err;
  }
  return teardown;
}
