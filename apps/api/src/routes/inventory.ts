// Owner: A3. Wave 0 stub — replace notImplemented handlers; keep the default export name.
import type { FastifyInstance } from 'fastify';
import { routes } from '@scheduler/contracts';
import { notImplemented } from './_stub.js';

export default async function inventoryRoutes(app: FastifyInstance) {
  app.get(routes.inventory, notImplemented);
  app.put(routes.inventoryItem, notImplemented);
}
