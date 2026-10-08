// A3: GET /dealerships/:id/availability (SPEC §6).
import { AvailabilityQuery, AvailabilityResponse, IdParams, routes } from '@scheduler/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getAvailability } from '../services/availability.js';

export default async function availabilityRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.get(
    routes.availability,
    { schema: { params: IdParams, querystring: AvailabilityQuery, response: { 200: AvailabilityResponse } } },
    async (req) => getAvailability(app.db, app.clock, req.params.id, req.query),
  );
}
