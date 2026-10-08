import './instrumentation.js'; // must stay first: patches http/pg before they load
import { buildApp } from './app.js';
import { clockFromEnv } from './clock.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { startNoShowSweeper } from './services/no-show-sweeper.js';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const app = await buildApp({
  db,
  clock: clockFromEnv(config.CLOCK_OVERRIDE),
  logger: { level: config.LOG_LEVEL },
  corsOrigin: config.CORS_ORIGIN,
});

// A7: late-arrival no-show sweeper (never in tests)
const stopSweeper =
  process.env.NODE_ENV === 'test' ? () => {} : startNoShowSweeper({ db, clock: app.clock, log: app.log });

const shutdown = async (signal: string) => {
  stopSweeper();
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.$client.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
