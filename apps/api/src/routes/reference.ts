// Owner: A3. Wave 0 stub — replace notImplemented handlers; keep the default export name.
import type { FastifyInstance } from 'fastify';
import { routes } from '@scheduler/contracts';
import { notImplemented } from './_stub.js';

export default async function referenceRoutes(app: FastifyInstance) {
  app.get(routes.dealerships, notImplemented);
  app.get(routes.serviceTypes, notImplemented);
  app.get(routes.customer, notImplemented);
  app.get(routes.customerVehicles, notImplemented);
}
