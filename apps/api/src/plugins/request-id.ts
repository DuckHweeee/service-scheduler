// Request id: honour an incoming `x-request-id`, else a uuid (see `requestIdOptions`); echo it on every response.
// Fastify binds the id to the request logger as `reqId`, so every pino line carries it.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export const REQUEST_ID_HEADER = 'x-request-id';

export const requestIdOptions = {
  requestIdHeader: REQUEST_ID_HEADER,
  genReqId: () => randomUUID(),
} as const;

export function registerRequestId(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    reply.header(REQUEST_ID_HEADER, req.id);
  });
}
