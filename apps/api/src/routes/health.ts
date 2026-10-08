import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DomainError } from '../domain/errors.js';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (req) => {
    try {
      await app.db.execute(sql`select 1`);
    } catch (err) {
      req.log.error({ err }, 'readiness check failed');
      throw new DomainError('INTERNAL_ERROR', 503, 'Database is not reachable');
    }
    return { status: 'ok' };
  });
}
