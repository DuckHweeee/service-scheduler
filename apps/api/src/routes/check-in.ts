// Owner: A7. Advisor check-in (SPEC §6.3).
import { AppointmentDetail, ReferenceParams, routes } from '@scheduler/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { checkInAppointment } from '../services/check-in.js';

export default async function checkInRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.post(
    routes.checkIn,
    { schema: { params: ReferenceParams, response: { 200: AppointmentDetail } } },
    async (req) => checkInAppointment({ db: app.db, clock: app.clock }, req.params.reference),
  );
}
