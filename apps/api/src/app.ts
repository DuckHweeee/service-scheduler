import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Clock } from './clock.js';
import type { Db } from './db/client.js';
import { registerObservability, traceLogMixin } from './observability/index.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerRequestId, REQUEST_ID_HEADER, requestIdOptions } from './plugins/request-id.js';
import healthRoutes from './routes/health.js';
import { registerRoutes } from './routes/index.js';

export interface AppDeps {
  db: Db;
  clock: Clock;
  /** `false` (default) silences logs; `true` or `{ level }` enables pino JSON logs. */
  logger?: boolean | { level: string };
  /** Allowed CORS origin; defaults to the Vite dev server. */
  corsOrigin?: string;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const logger =
    deps.logger === true ? { level: 'info', mixin: traceLogMixin } : deps.logger ? { ...deps.logger, mixin: traceLogMixin } : false;
  const app = Fastify({ logger, ...requestIdOptions });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('db', deps.db);
  app.decorate('clock', deps.clock);

  registerRequestId(app);
  await registerObservability(app);
  registerErrorHandler(app);

  await app.register(cors, {
    origin: deps.corsOrigin ?? 'http://localhost:5173',
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'],
    exposedHeaders: [REQUEST_ID_HEADER],
  });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Unified Service Scheduler API', version: '0.1.0' },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(healthRoutes);
  await registerRoutes(app);
  return app;
}
