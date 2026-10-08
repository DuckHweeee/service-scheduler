// RFC 7807 problem+json rendering for every failure path (SPEC §6). Installed directly on the root instance
// (not via app.register) so the handlers apply to all encapsulated route plugins.
import type { ErrorCode, Problem } from '@scheduler/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { DomainError } from '../domain/errors.js';

const PROBLEM_BASE = 'https://scheduler.example/problems/';

const humanise = (code: string): string => {
  const words = code.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const problem = (
  code: ErrorCode,
  status: number,
  detail: string,
  extras: Partial<Pick<Problem, 'errors' | 'reason' | 'alternatives'>> = {},
): Problem => ({
  type: PROBLEM_BASE + code.toLowerCase().replaceAll('_', '-'),
  title: humanise(code),
  status,
  code,
  detail,
  ...extras,
});

/** Walks `error.cause` (drizzle wraps driver errors) looking for a Postgres SQLSTATE. */
export const pgErrorCode = (err: unknown): string | undefined => {
  let cur: unknown = err;
  for (let depth = 0; cur && typeof cur === 'object' && depth < 5; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
};

const send = (reply: FastifyReply, body: Problem) =>
  reply.status(body.status).type('application/problem+json').send(body);

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) =>
    send(reply, problem('NOT_FOUND', 404, `Route ${req.method} ${req.url.split('?')[0]} not found`)),
  );

  app.setErrorHandler((err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof DomainError) {
      const { reason, alternatives } = err.extras;
      return send(
        reply,
        problem(err.code, err.status, err.message, {
          ...(reason ? { reason } : {}),
          ...(alternatives ? { alternatives } : {}),
        }),
      );
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      const errors = err.validation.map((v) => ({
        path: v.instancePath.replace(/^\//, '').replaceAll('/', '.') || '(root)',
        message: v.message ?? 'Invalid value',
      }));
      return send(reply, problem('VALIDATION_ERROR', 400, 'Request validation failed', { errors }));
    }

    if (pgErrorCode(err) === '23P01') {
      req.log.warn({ err }, 'exclusion violation (double booking prevented by the database)');
      return send(reply, problem('SLOT_UNAVAILABLE', 409, 'The requested slot is no longer available'));
    }

    const status = (err as FastifyError).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return send(reply, problem(status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', status, err.message));
    }

    req.log.error({ err }, 'unhandled error');
    return send(reply, problem('INTERNAL_ERROR', 500, 'Internal server error'));
  });
}
