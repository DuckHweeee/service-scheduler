import { trace } from '@opentelemetry/api';
import { tracing } from '@opentelemetry/sdk-node';
import { afterAll, describe, expect, it } from 'vitest';
import { createMetrics } from '../../src/observability/metrics.js';
import { createTelemetry } from '../../src/observability/otel-telemetry.js';
import { getTracing, startTracing, traceLogMixin } from '../../src/observability/tracing.js';

const exporter = new tracing.InMemorySpanExporter();
const quietLog = () => ({ info: () => {} });

afterAll(async () => {
  await getTracing()?.shutdown();
});

describe('observability (unit)', () => {
  it('does not start the SDK when OTEL_EXPORTER_OTLP_ENDPOINT is unset or blank', () => {
    expect(startTracing({})).toBeUndefined();
    expect(startTracing({ OTEL_EXPORTER_OTLP_ENDPOINT: '  ' })).toBeUndefined();
    expect(getTracing()).toBeUndefined();
    expect(traceLogMixin()).toEqual({});
  });

  it('withSpan records a span with attributes, and the log mixin carries trace_id/span_id inside it', async () => {
    startTracing({}, { spanProcessors: [new tracing.SimpleSpanProcessor(exporter)] });
    await new Promise((r) => setTimeout(r, 50)); // NodeSDK finishes registering the provider asynchronously
    const telemetry = createTelemetry(createMetrics(), quietLog);
    let mixin: Record<string, string> = {};
    await telemetry.withSpan('booking.reserve', { 'dealership.id': 'DLR-01' }, async (span) => {
      span.setAttributes({ 'booking.outcome': 'created' });
      mixin = traceLogMixin();
      expect(mixin.trace_id).not.toBe('0'.repeat(32));
      expect(mixin.trace_id).toBe(trace.getActiveSpan()!.spanContext().traceId);
    });
    expect(mixin.span_id).toMatch(/^[0-9a-f]{16}$/);
    await new Promise((r) => setTimeout(r, 10));
    const [span] = exporter.getFinishedSpans();
    expect(span!.name).toBe('booking.reserve');
    expect(span!.attributes).toMatchObject({ 'dealership.id': 'DLR-01', 'booking.outcome': 'created' });
  });

  it('metrics: counter and histograms register in an isolated registry', async () => {
    const m = createMetrics();
    const t = createTelemetry(m, quietLog);
    t.bookingAttempt({ outcome: 'created', reason: 'none', channel: 'ADVANCE' });
    t.observeReserve(0.01);
    t.observeLockWait(0.001);
    t.observeAvailability(0.002, false);
    t.noShowReleased(2);
    const text = await m.registry.metrics();
    expect(text).toContain('booking_attempts_total{outcome="created",reason="none",channel="ADVANCE"} 1');
    expect(text).toContain('booking_reserve_duration_seconds_count 1');
    expect(text).toContain('booking_lock_wait_seconds_count 1');
    expect(text).toContain('availability_compute_duration_seconds_count{same_day="false"} 1');
    expect(text).toContain('no_show_released_total 2');
  });
});
