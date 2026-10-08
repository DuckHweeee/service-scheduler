// Opus-owned. Every SPEC §6 route module is registered here once; WPs only edit their own module.
import type { FastifyInstance } from 'fastify';
import appointmentsRoutes from './appointments.js';
import availabilityRoutes from './availability.js';
import boardRoutes from './board.js';
import checkInRoutes from './check-in.js';
import inventoryRoutes from './inventory.js';
import referenceRoutes from './reference.js';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(referenceRoutes);
  await app.register(availabilityRoutes);
  await app.register(boardRoutes);
  await app.register(inventoryRoutes);
  await app.register(appointmentsRoutes);
  await app.register(checkInRoutes);
}
