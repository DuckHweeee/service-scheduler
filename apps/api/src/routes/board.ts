// A3: GET /dealerships/:id/board (SPEC §6, S3).
import { BoardQuery, BoardResponse, IdParams, routes } from '@scheduler/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getBoard } from '../services/board.js';

export default async function boardRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.get(
    routes.board,
    { schema: { params: IdParams, querystring: BoardQuery, response: { 200: BoardResponse } } },
    async (req) => getBoard(app.db, req.params.id, req.query.date),
  );
}
