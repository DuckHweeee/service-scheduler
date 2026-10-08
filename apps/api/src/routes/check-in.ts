// Owner: A7. Wave 0 stub — replace notImplemented handlers; keep the default export name.
import type { FastifyInstance } from 'fastify';
import { routes } from '@scheduler/contracts';
import { notImplemented } from './_stub.js';

export default async function checkInRoutes(app: FastifyInstance) {
  app.post(routes.checkIn, notImplemented);
}
