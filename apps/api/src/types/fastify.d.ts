// Opus-owned. Decorators available on every Fastify instance (registered in app.ts).
import type { Clock } from '../clock.js';
import type { Db } from '../db/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    clock: Clock;
  }
}
