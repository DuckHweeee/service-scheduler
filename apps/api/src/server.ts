import { buildApp } from './app.js';
import { clockFromEnv } from './clock.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const app = await buildApp({
  db,
  clock: clockFromEnv(config.CLOCK_OVERRIDE),
  logger: { level: config.LOG_LEVEL },
  corsOrigin: config.CORS_ORIGIN,
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.$client.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
