// OpenTelemetry bootstrap. `startTracing` is a no-op (returns undefined) unless OTEL_EXPORTER_OTLP_ENDPOINT is set
// or explicit span processors are injected (tests).
import { FastifyOtelInstrumentation } from '@fastify/otel';
import { context, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK, type tracing } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export const SERVICE_NAME = 'scheduler-api';

export interface TracingHandle {
  sdk: NodeSDK;
  fastifyOtel: FastifyOtelInstrumentation;
  shutdown: () => Promise<void>;
}

let handle: TracingHandle | undefined;

/** The running tracing setup, if any (the Fastify plugin registers the fastify instrumentation from it). */
export const getTracing = (): TracingHandle | undefined => handle;

export function startTracing(
  env: NodeJS.ProcessEnv = process.env,
  opts: { spanProcessors?: tracing.SpanProcessor[] } = {},
): TracingHandle | undefined {
  if (handle) return handle;
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint && !opts.spanProcessors) return undefined;

  const fastifyOtel = new FastifyOtelInstrumentation({ registerOnInitialization: false });
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
    ...(opts.spanProcessors
      ? { spanProcessors: opts.spanProcessors }
      : { traceExporter: new OTLPTraceExporter({ url: `${endpoint!.replace(/\/$/, '')}/v1/traces` }) }),
    instrumentations: [new HttpInstrumentation(), new PgInstrumentation(), fastifyOtel],
  });
  sdk.start();
  const started: TracingHandle = {
    sdk,
    fastifyOtel,
    shutdown: async () => {
      handle = undefined;
      await sdk.shutdown();
    },
  };
  handle = started;
  return started;
}

/** pino `mixin`: adds trace_id/span_id when a span is active. */
export const traceLogMixin = (): Record<string, string> => {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const sc = span.spanContext();
  return { trace_id: sc.traceId, span_id: sc.spanId };
};
