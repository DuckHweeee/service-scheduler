import { SpanStatusCode, trace } from '@opentelemetry/api';
import { bookingLabels, type Metrics } from './metrics.js';
import type { SpanAttributes, SpanHandle, Telemetry } from './telemetry.js';

export interface LogLike {
  info(obj: object, msg: string): void;
}

/** Telemetry backed by prom-client metrics and (when an SDK is registered) OpenTelemetry spans. */
export function createTelemetry(m: Metrics, getLog: () => LogLike): Telemetry {
  // Resolved per call: the global tracer provider may be installed after this module loads.
  const tracer = () => trace.getTracer('scheduler-api');
  return {
    bookingAttempt: (a) => {
      m.bookingAttempts.inc(bookingLabels(a));
      getLog().info(
        {
          dealershipId: a.dealershipId,
          serviceTypeCode: a.serviceTypeCode,
          channel: a.channel,
          outcome: a.outcome,
          reason: a.reason,
          durationMs: a.durationMs,
        },
        'booking attempt',
      );
    },
    observeReserve: (s) => m.reserveDuration.observe(s),
    observeLockWait: (s) => m.lockWait.observe(s),
    observeAvailability: (s, sameDay) => m.availabilityDuration.observe({ same_day: String(sameDay) }, s),
    noShowReleased: (count = 1) => m.noShowReleased.inc(count),
    withSpan: <T>(name: string, attrs: SpanAttributes, fn: (span: SpanHandle) => Promise<T>) =>
      tracer().startActiveSpan(name, { attributes: attrs }, async (span) => {
        try {
          return await fn({ setAttributes: (a) => void span.setAttributes(a) });
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      }),
  };
}
