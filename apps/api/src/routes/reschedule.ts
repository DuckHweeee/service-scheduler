// Owner: W5-A8. POST /appointments/:reference/reschedule (SPEC §6.5). Wave 5 stub until A8 implements it.
import { routes } from '@scheduler/contracts';
import type { FastifyInstance } from 'fastify';
import { notImplemented } from './_stub.js';

export default async function rescheduleRoutes(app: FastifyInstance) {
  app.post(routes.rescheduleAppointment, notImplemented);
}
