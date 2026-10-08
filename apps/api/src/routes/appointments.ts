// Owner: A4. Wave 0 stub — replace notImplemented handlers; keep the default export name.
import type { FastifyInstance } from 'fastify';
import { routes } from '@scheduler/contracts';
import { notImplemented } from './_stub.js';

export default async function appointmentsRoutes(app: FastifyInstance) {
  app.post(routes.appointments, notImplemented);
  app.get(routes.appointments, notImplemented);
  app.get(routes.appointment, notImplemented);
  app.post(routes.cancelAppointment, notImplemented);
}
