import { randomUUID } from 'node:crypto';
import { paths, Problem, type CreateAppointmentRequest } from '@scheduler/contracts';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock.js';
import type { Db } from '../../src/db/client.js';
import { appointments, bookingEvents, vehicles } from '../../src/db/schema.js';
import { buildTestApp, createTestDb, seedReference, type TestDb } from '../helpers/index.js';

// ADR-002: the advisory lock serialises a dealership-day; the exclusion constraints are the final guarantee.
// 20 genuinely parallel requests (Promise.all over app.inject, each on its own pg Pool connection, pool max 10).
let t: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  t = await createTestDb();
  await seedReference(t.db);
  app = await buildTestApp({ db: t.db, clock: fixedClock('2026-10-08T09:10:00+07:00') });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await t.cleanup();
});

// ---- local helpers (each test file is self-contained) ----
let seq = 0;
const post = (app: FastifyInstance, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: paths.appointments, payload: payload as object, headers });

const bookingBody = (o: Partial<CreateAppointmentRequest> = {}): CreateAppointmentRequest => ({
  customerId: 'CUS-10482',
  vehicleId: 'VEH-01',
  dealershipId: 'DLR-01',
  serviceTypeCode: 'BRAKE_PAD_REPLACEMENT',
  date: '2026-10-09',
  startTime: '10:00',
  bookingSessionId: randomUUID(),
  ...o,
});

/** Extra vehicles for CUS-10482 (ICE Crossover LX by default). */
const addVehicles = async (db: Db, count: number, prefix = 'VEH-X', model = 'Crossover LX', powertrain: 'ICE' | 'EV' = 'ICE') => {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    seq += 1;
    const id = `${prefix}${String(seq).padStart(3, '0')}`;
    await db.insert(vehicles).values({
      id,
      customerId: 'CUS-10482',
      modelYear: 2022,
      modelName: model,
      powertrain,
      vin: `XVIN${String(seq).padStart(13, '0')}`,
      plate: null,
    });
    ids.push(id);
  }
  return ids;
};

/** Directly occupy a technician and bay (a CONFIRMED background appointment). */
const occupy = async (db: Db, o: { tech: string; bay: string; date: string; from: string; to: string; dealership?: string }) => {
  const [vehicleId] = await addVehicles(db, 1, 'VEH-B');
  seq += 1;
  const startAt = new Date(`${o.date}T${o.from}:00+07:00`);
  const endAt = new Date(`${o.date}T${o.to}:00+07:00`);
  await db.insert(appointments).values({
    reference: `APT-${o.date.replaceAll('-', '')}-9${String(seq).padStart(3, '0')}`,
    channel: 'ADVANCE',
    customerId: 'CUS-10482',
    vehicleId: vehicleId!,
    dealershipId: o.dealership ?? 'DLR-01',
    serviceTypeCode: 'GENERAL_INSPECTION',
    technicianId: o.tech,
    serviceBayId: o.bay,
    startAt,
    endAt,
    durationMin: (endAt.getTime() - startAt.getTime()) / 60_000,
  });
};

const eventTypes = async (db: Db, sessionId: string) =>
  (
    await db
      .select({ type: bookingEvents.type })
      .from(bookingEvents)
      .where(eq(bookingEvents.sessionId, sessionId))
      .orderBy(asc(bookingEvents.id))
  ).map((e) => e.type);

// ---- end helpers ----


const fire = async (date: string, n = 20) => {
  const ids = await addVehicles(t.db, n, 'VEH-K');
  return Promise.all(ids.map((vehicleId) => post(app, bookingBody({ vehicleId, date, startTime: '10:00' }))));
};

const rowsAt = (date: string) =>
  t.db
    .select()
    .from(appointments)
    .where(and(eq(appointments.status, 'CONFIRMED'), eq(appointments.serviceTypeCode, 'BRAKE_PAD_REPLACEMENT'), eq(appointments.startAt, new Date(`${date}T10:00:00+07:00`))));

describe('concurrent bookings of the same window', () => {
  it('capacity 1 (only TEC-03 free): 20 parallel → exactly 1×201, 19×409, one CONFIRMED row', async () => {
    const date = '2026-10-12';
    await occupy(t.db, { tech: 'TEC-01', bay: 'BAY-03', date, from: '08:00', to: '17:00' });
    const results = await fire(date);
    const statuses = results.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(19);
    for (const r of results.filter((x) => x.statusCode === 409)) {
      expect(Problem.parse(r.json()).code).toBe('SLOT_UNAVAILABLE');
    }
    const rows = await rowsAt(date);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ technicianId: 'TEC-03' });
  });

  it('capacity 2 (TEC-01 and TEC-03 free): 20 parallel → exactly 2×201, 18×409', async () => {
    const date = '2026-10-13';
    const results = await fire(date);
    const statuses = results.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(statuses.filter((s) => s === 409)).toHaveLength(18);
    const rows = await rowsAt(date);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.technicianId))).toEqual(new Set(['TEC-01', 'TEC-03']));
    expect(new Set(rows.map((r) => r.serviceBayId)).size).toBe(2);
  });

  it('overlapping (not identical) windows also never double-book a technician', async () => {
    const date = '2026-10-14';
    await occupy(t.db, { tech: 'TEC-01', bay: 'BAY-03', date, from: '08:00', to: '17:00' });
    const ids = await addVehicles(t.db, 12, 'VEH-O');
    const starts = ['09:00', '09:30', '10:00', '10:30'];
    const results = await Promise.all(
      ids.map((vehicleId, i) => post(app, bookingBody({ vehicleId, date, startTime: starts[i % starts.length]! }))),
    );
    // Only TEC-03 is free all day and every brake job is 120 minutes: any two of the starts overlap.
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.every((r) => r.statusCode === 201 || r.statusCode === 409)).toBe(true);
    const brakes = await t.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.status, 'CONFIRMED'), eq(appointments.serviceTypeCode, 'BRAKE_PAD_REPLACEMENT'), eq(appointments.technicianId, 'TEC-03')));
    expect(brakes.filter((r) => r.startAt >= new Date(`${date}T00:00:00+07:00`) && r.startAt < new Date(`${date}T23:59:00+07:00`))).toHaveLength(1);
  });

  it('every failed attempt left a CHECK_FAILED event; the winner has the full event chain', async () => {
    const date = '2026-10-15';
    await occupy(t.db, { tech: 'TEC-01', bay: 'BAY-03', date, from: '08:00', to: '17:00' });
    const ids = await addVehicles(t.db, 8, 'VEH-E');
    const bodies = ids.map((vehicleId) => bookingBody({ vehicleId, date }));
    const results = await Promise.all(bodies.map((b) => post(app, b)));
    for (const [i, r] of results.entries()) {
      const types = await eventTypes(t.db, bodies[i]!.bookingSessionId);
      expect(types).toEqual(
        r.statusCode === 201
          ? ['SLOT_REQUESTED', 'CHECK_PASSED', 'RESOURCES_RESERVED', 'APPOINTMENT_CREATED']
          : ['SLOT_REQUESTED', 'CHECK_FAILED'],
      );
    }
  });
});
