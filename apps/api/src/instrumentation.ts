// Imported first by server.ts so auto-instrumentation can patch http/pg before they load.
// Starts the OpenTelemetry SDK only when OTEL_EXPORTER_OTLP_ENDPOINT is set.
import { startTracing } from './observability/tracing.js';

const tracing = startTracing();
if (tracing) {
  const stop = () => void tracing.shutdown();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
