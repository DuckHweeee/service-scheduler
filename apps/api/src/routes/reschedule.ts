// POST /appointments/:reference/reschedule (SPEC §6.5, ADR-006).
import { AppointmentDetail, ReferenceParams, RescheduleAppointmentRequest, routes } from '@scheduler/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { rescheduleAppointment } from '../services/reschedule.js';

export default async function rescheduleRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.post(
    routes.rescheduleAppointment,
    { schema: { params: ReferenceParams, body: RescheduleAppointmentRequest, response: { 200: AppointmentDetail } } },
    async (req) => rescheduleAppointment({ db: app.db, clock: app.clock }, req.params.reference, req.body),
  );
}
