// Fastify wiring: per-app metrics registry, HTTP duration histogram, GET /metrics, telemetry installation.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';
import { createMetrics } from './metrics.js';
import { createTelemetry } from './otel-telemetry.js';
import { setTelemetry } from './telemetry.js';
import { getTracing } from './tracing.js';

export async function registerObservability(app: FastifyInstance): Promise<void> {
  const metrics = createMetrics();
  // Services have no logger; the request-bound child logger (carrying reqId) travels via AsyncLocalStorage.
  const requestLog = new AsyncLocalStorage<FastifyInstance['log']>();
  setTelemetry(createTelemetry(metrics, () => requestLog.getStore() ?? app.log));

  const tracing = getTracing();
  if (tracing) await app.register(tracing.fastifyOtel.plugin());

  const starts = new WeakMap<object, bigint>();
  app.addHook('onRequest', async (req) => {
    starts.set(req, process.hrtime.bigint());
    requestLog.enterWith(req.log);
  });
  app.addHook('onResponse', async (req, reply) => {
    const t0 = starts.get(req);
    if (t0 === undefined) return;
    // routeOptions.url is the pattern; unmatched requests (404) share one label so cardinality stays bounded.
    const route = req.routeOptions?.url ?? 'unmatched';
    if (route === '/metrics') return;
    metrics.httpDuration.observe(
      { method: req.method, route, status_code: String(reply.statusCode) },
      Number(process.hrtime.bigint() - t0) / 1e9,
    );
  });

  app.get('/metrics', { schema: { hide: true } }, async (_req, reply) => {
    return reply.type(metrics.registry.contentType).send(await metrics.registry.metrics());
  });
}
