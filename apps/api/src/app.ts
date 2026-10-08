// Wave 0 minimal app — A1 owns this file and extends it (config, logging, error handler, swagger, health).
import Fastify from 'fastify';
import type { Clock } from './clock.js';
import type { Db } from './db/client.js';
import { registerRoutes } from './routes/index.js';

export interface AppDeps {
  db: Db;
  clock: Clock;
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: false });
  app.decorate('db', deps.db);
  app.decorate('clock', deps.clock);
  await registerRoutes(app);
  return app;
}
