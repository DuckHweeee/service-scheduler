// Opus-owned helper for Wave 0 route stubs. Delete usages as routes get implemented.
import type { FastifyReply, FastifyRequest } from 'fastify';

export const notImplemented = async (_req: FastifyRequest, reply: FastifyReply) =>
  reply.status(501).type('application/problem+json').send({
    type: 'about:blank',
    title: 'Not implemented',
    status: 501,
    code: 'INTERNAL_ERROR',
    detail: 'This endpoint is stubbed in Wave 0.',
  });
