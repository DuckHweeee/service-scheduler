import { randomUUID } from 'node:crypto';
import { tracing } from '@opentelemetry/sdk-node';
import { paths, type CreateAppointmentRequest } from '@scheduler/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock.js';
import { getTracing, startTracing } from '../../src/observability/tracing.js';
import { buildTestApp, createTestDb, seedReference, type TestDb } from '../helpers/index.js';

const exporter = new tracing.InMemorySpanExporter();
let t: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  startTracing({}, { spanProcessors: [new tracing.SimpleSpanProcessor(exporter)] });
  t = await createTestDb();
  await seedReference(t.db);
  app = await buildTestApp({ db: t.db, clock: fixedClock('2026-10-08T09:10:00+07:00') });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await t.cleanup();
  await getTracing()?.shutdown();
});

const body = (o: Partial<CreateAppointmentRequest> = {}): CreateAppointmentRequest => ({
  customerId: 'CUS-10482',
  vehicleId: 'VEH-01',
  dealershipId: 'DLR-01',
  serviceTypeCode: 'BRAKE_PAD_REPLACEMENT',
  date: '2026-10-09',
  startTime: '10:00',
  bookingSessionId: randomUUID(),
  ...o,
});
const post = (payload: object) => app.inject({ method: 'POST', url: paths.appointments, payload });

describe('observability (integration)', () => {
  it('/metrics reports a created booking and a rejected one, with histogram counts', async () => {
    const ok = await post(body());
    expect(ok.statusCode).toBe(201);
    const reference = (ok.json() as { reference: string }).reference;

    const rejected = await post(body({ dealershipId: 'DLR-03', serviceTypeCode: 'WHEEL_ALIGNMENT', date: '2026-10-12' }));
    expect(rejected.statusCode).toBe(409);
    const reason = (rejected.json() as { reason: string }).reason;
    expect(reason).toBe('NO_QUALIFIED_TECHNICIAN');

    await app.inject({ method: 'GET', url: `${paths.availability('DLR-01')}?serviceType=OIL_CHANGE&date=2026-10-09&vehicleId=VEH-01` });
    await app.inject({ method: 'GET', url: `${paths.appointments}/${reference}` });
    await app.inject({ method: 'GET', url: `${paths.appointments}/APT-20261009-9999` });

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    const text = res.body;
    expect(text).toContain('booking_attempts_total{outcome="created",reason="none",channel="ADVANCE"} 1');
    expect(text).toContain(`booking_attempts_total{outcome="rejected",reason="${reason}",channel="ADVANCE"} 1`);
    expect(text).toMatch(/booking_reserve_duration_seconds_count 2/);
    expect(text).toMatch(/booking_lock_wait_seconds_count 2/);
    expect(text).toMatch(/availability_compute_duration_seconds_count\{same_day="false"\} 1/);
    expect(text).toContain('process_cpu_user_seconds_total');
  });

  it('http histogram labels use the route pattern, never the concrete URL', async () => {
    const text = (await app.inject({ method: 'GET', url: '/metrics' })).body;
    expect(text).toContain('route="/api/v1/appointments/:reference"');
    expect(text).toContain('route="/api/v1/dealerships/:id/availability"');
    expect(text).not.toMatch(/route="[^"]*APT-2026/);
    expect(text).not.toContain('route="/metrics"');
  });

  it('/metrics is hidden from the OpenAPI document', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/docs/json' })).json() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).not.toContain('/metrics');
  });

  it('a booking produces a booking.reserve span (no PII) and an availability.compute span', () => {
    const spans = exporter.getFinishedSpans();
    const reserve = spans.filter((s) => s.name === 'booking.reserve');
    expect(reserve).toHaveLength(2);
    expect(reserve.find((s) => s.attributes['booking.outcome'] === 'created')!.attributes).toMatchObject({
      'dealership.id': 'DLR-01',
      'service.code': 'BRAKE_PAD_REPLACEMENT',
      'booking.channel': 'ADVANCE',
      'booking.reason': 'none',
    });
    expect(reserve.find((s) => s.attributes['booking.outcome'] === 'rejected')!.attributes).toMatchObject({
      'booking.reason': 'NO_QUALIFIED_TECHNICIAN',
    });
    for (const s of reserve) expect(JSON.stringify(s.attributes)).not.toContain('CUS-10482');
    expect(spans.some((s) => s.name === 'availability.compute')).toBe(true);
  });
});
