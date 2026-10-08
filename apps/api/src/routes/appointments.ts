// Owner: A4. Booking command (create), list, detail, cancel.
import {
  AppointmentDetail,
  AppointmentList,
  CancelAppointmentRequest,
  CreateAppointmentRequest,
  IDEMPOTENCY_HEADER,
  ListAppointmentsQuery,
  ReferenceParams,
  routes,
} from '@scheduler/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { DomainError } from '../domain/errors.js';
import { getAppointmentDetail, listAppointments } from '../services/appointment-query.js';
import { createAppointment } from '../services/booking.js';
import { cancelAppointment } from '../services/cancellation.js';

export default async function appointmentsRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.post(
    routes.appointments,
    { schema: { body: CreateAppointmentRequest, response: { 200: AppointmentDetail, 201: AppointmentDetail } } },
    async (req, reply) => {
      const raw = req.headers[IDEMPOTENCY_HEADER];
      const key = (Array.isArray(raw) ? raw[0] : raw)?.trim();
      if (key !== undefined && key.length > 255) {
        throw new DomainError('VALIDATION_ERROR', 400, 'Idempotency-Key must be at most 255 characters');
      }
      const { created, appointment } = await createAppointment(
        { db: app.db, clock: app.clock },
        req.body,
        key || undefined,
      );
      return reply.status(created ? 201 : 200).send(appointment);
    },
  );

  app.get(
    routes.appointments,
    { schema: { querystring: ListAppointmentsQuery, response: { 200: AppointmentList } } },
    async (req) => ({ items: await listAppointments(app.db, app.clock, req.query) }),
  );

  app.get(
    routes.appointment,
    { schema: { params: ReferenceParams, response: { 200: AppointmentDetail } } },
    async (req) => getAppointmentDetail(app.db, req.params.reference),
  );

  app.post(
    routes.cancelAppointment,
    { schema: { params: ReferenceParams, body: CancelAppointmentRequest.nullish(), response: { 200: AppointmentDetail } } },
    async (req) => cancelAppointment({ db: app.db, clock: app.clock }, req.params.reference, req.body?.reason),
  );
}
