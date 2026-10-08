import { randomUUID } from 'node:crypto';
import { AppointmentDetail, paths, Problem, type CreateAppointmentRequest } from '@scheduler/contracts';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock.js';
import type { Db } from '../../src/db/client.js';
import { appointments, bookingEvents, vehicles } from '../../src/db/schema.js';
import { buildTestApp, createTestDb, seedReference, type TestDb } from '../helpers/index.js';

// 2026-10-08 is a Thursday, 09:10 local (UTC+7). Advance bookings use Fri 2026-10-09.
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

const confirmedCount = async (db: Db, where?: SQL) =>
  (await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.status, 'CONFIRMED'), where))).length;
// ---- end helpers ----


const problem = (res: { json: () => unknown }) => Problem.parse(res.json());

describe('POST /appointments: happy path', () => {
  it('T9 brake on an empty day → 201, TEC-03 / BAY-01, events in order', async () => {
    const body = bookingBody({ vehicleId: 'VEH-01' });
    const res = await post(app, body);
    expect(res.statusCode).toBe(201);
    const detail = AppointmentDetail.parse(res.json());
    expect(detail).toMatchObject({
      status: 'CONFIRMED',
      channel: 'ADVANCE',
      localDate: '2026-10-09',
      startTime: '10:00',
      endTime: '12:00',
      startAt: '2026-10-09T10:00:00+07:00',
      durationMin: 120,
      technician: { id: 'TEC-03', name: 'Riya Patel' },
      serviceBay: { id: 'BAY-01' },
      parts: [],
    });
    expect(detail.reference).toMatch(/^APT-20261009-\d{4}$/);

    const rows = await t.db.select().from(appointments).where(eq(appointments.reference, detail.reference));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ technicianId: 'TEC-03', serviceBayId: 'BAY-01', bookingSessionId: body.bookingSessionId });
    expect(await eventTypes(t.db, body.bookingSessionId)).toEqual([
      'SLOT_REQUESTED',
      'CHECK_PASSED',
      'RESOURCES_RESERVED',
      'APPOINTMENT_CREATED',
    ]);
    expect(detail.history.map((h) => h.type)).toEqual([
      'SLOT_REQUESTED',
      'CHECK_PASSED',
      'RESOURCES_RESERVED',
      'APPOINTMENT_CREATED',
    ]);
  });

  it('back-to-back booking is allowed for the same vehicle, technician and bay (half-open intervals)', async () => {
    const [v] = await addVehicles(t.db, 1);
    const first = await post(app, bookingBody({ vehicleId: v!, date: '2026-10-13', startTime: '08:00' }));
    const second = await post(app, bookingBody({ vehicleId: v!, date: '2026-10-13', startTime: '10:00' }));
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().technician.id).toBe(first.json().technician.id);
    expect(second.json().serviceBay.id).toBe(first.json().serviceBay.id);
  });
});

describe('POST /appointments: unavailable window', () => {
  it('409 SLOT_UNAVAILABLE with reason and ≤5 alternatives; CHECK_FAILED persisted despite rollback', async () => {
    // Brake needs BRAKES: only TEC-01 and TEC-03. Block both for 09:00-13:00 on Mon 2026-10-12.
    await occupy(t.db, { tech: 'TEC-01', bay: 'BAY-03', date: '2026-10-12', from: '09:00', to: '13:00' });
    await occupy(t.db, { tech: 'TEC-03', bay: 'BAY-04', date: '2026-10-12', from: '09:00', to: '13:00' });
    const before = await confirmedCount(t.db);

    const body = bookingBody({ date: '2026-10-12', startTime: '10:00' });
    const res = await post(app, body);
    expect(res.statusCode).toBe(409);
    const p = problem(res);
    expect(p).toMatchObject({ code: 'SLOT_UNAVAILABLE', reason: 'NO_QUALIFIED_TECHNICIAN' });
    expect(p.alternatives).toHaveLength(5);
    expect(p.alternatives![0]).toMatchObject({ date: '2026-10-12', startTime: '13:00' });

    expect(await confirmedCount(t.db)).toBe(before);
    expect(await eventTypes(t.db, body.bookingSessionId)).toEqual(['SLOT_REQUESTED', 'CHECK_FAILED']);
    const [failed] = await t.db
      .select()
      .from(bookingEvents)
      .where(and(eq(bookingEvents.sessionId, body.bookingSessionId), eq(bookingEvents.type, 'CHECK_FAILED')));
    expect(failed!.detail).toMatchObject({ reason: 'NO_QUALIFIED_TECHNICIAN', alternativeCount: 5 });
  });

  it('the whole duration is checked, not just the start (partial overlap rejects)', async () => {
    // TEC-01 and TEC-03 are busy 09:00-13:00 on 2026-10-12; a brake at 08:00 ends 10:00 and overlaps.
    const res = await post(app, bookingBody({ date: '2026-10-12', startTime: '08:00' }));
    expect(res.statusCode).toBe(409);
    expect(problem(res).reason).toBe('NO_QUALIFIED_TECHNICIAN');
  });
});

describe('POST /appointments: vehicle already booked', () => {
  it('overlapping window at another dealership → 409 VEHICLE_ALREADY_BOOKED', async () => {
    const [v] = await addVehicles(t.db, 1);
    const first = await post(app, bookingBody({ vehicleId: v!, date: '2026-10-14', startTime: '10:00' }));
    expect(first.statusCode).toBe(201);
    const body = bookingBody({ vehicleId: v!, dealershipId: 'DLR-02', date: '2026-10-14', startTime: '11:00' });
    const res = await post(app, body);
    expect(res.statusCode).toBe(409);
    expect(problem(res).code).toBe('VEHICLE_ALREADY_BOOKED');
    expect(await eventTypes(t.db, body.bookingSessionId)).toEqual(['SLOT_REQUESTED', 'CHECK_FAILED']);
  });

  it('a non-overlapping window for the same vehicle is fine', async () => {
    const [v] = await addVehicles(t.db, 1);
    expect((await post(app, bookingBody({ vehicleId: v!, date: '2026-10-14', startTime: '08:00' }))).statusCode).toBe(201);
    expect((await post(app, bookingBody({ vehicleId: v!, dealershipId: 'DLR-02', date: '2026-10-14', startTime: '10:00' }))).statusCode).toBe(201);
  });
});

describe('POST /appointments: idempotency', () => {
  it('same Idempotency-Key sequentially → 200 with the same reference, one row, no new events', async () => {
    const [v] = await addVehicles(t.db, 1);
    const body = bookingBody({ vehicleId: v!, date: '2026-10-15' });
    const key = `key-${randomUUID()}`;
    const a = await post(app, body, { 'idempotency-key': key });
    expect(a.statusCode).toBe(201);
    const events = await eventTypes(t.db, body.bookingSessionId);
    const b = await post(app, body, { 'idempotency-key': key });
    expect(b.statusCode).toBe(200);
    expect(b.json().reference).toBe(a.json().reference);
    expect(await eventTypes(t.db, body.bookingSessionId)).toEqual(events);
    expect(await confirmedCount(t.db, eq(appointments.idempotencyKey, key))).toBe(1);
  });

  it('same Idempotency-Key concurrently → exactly one row', async () => {
    const [v] = await addVehicles(t.db, 1);
    const body = bookingBody({ vehicleId: v!, date: '2026-10-15', startTime: '13:00' });
    const key = `key-${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 6 }, () => post(app, body, { 'idempotency-key': key })));
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(new Set(results.map((r) => r.json().reference)).size).toBe(1);
    expect(await confirmedCount(t.db, eq(appointments.idempotencyKey, key))).toBe(1);
  });
});

describe('POST /appointments: validation', () => {
  const expectCode = async (o: Partial<CreateAppointmentRequest>, status: number, code: string) => {
    const body = bookingBody(o);
    const res = await post(app, body);
    expect(res.statusCode, res.body).toBe(status);
    expect(problem(res).code).toBe(code);
    // validation errors write no events at all
    expect(await eventTypes(t.db, body.bookingSessionId)).toEqual([]);
  };

  it('MISALIGNED_START at 10:15', () => expectCode({ startTime: '10:15' }, 422, 'MISALIGNED_START'));
  it('OUTSIDE_OPENING_HOURS: a brake at 16:00 would end at 18:00', () => expectCode({ startTime: '16:00' }, 422, 'OUTSIDE_OPENING_HOURS'));
  it('OUTSIDE_OPENING_HOURS: before opening', () => expectCode({ startTime: '07:30' }, 422, 'OUTSIDE_OPENING_HOURS'));
  it('weekend → DEALERSHIP_CLOSED', () => expectCode({ date: '2026-10-10' }, 422, 'DEALERSHIP_CLOSED'));
  it('past date → OUTSIDE_BOOKING_HORIZON', () => expectCode({ date: '2026-10-07' }, 422, 'OUTSIDE_BOOKING_HORIZON'));
  it('> 30 days → OUTSIDE_BOOKING_HORIZON', () => expectCode({ date: '2026-11-09' }, 422, 'OUTSIDE_BOOKING_HORIZON'));
  it('VEHICLE_NOT_OWNED', () => expectCode({ customerId: 'CUS-10001', vehicleId: 'VEH-01' }, 422, 'VEHICLE_NOT_OWNED'));
  it('SERVICE_NOT_APPLICABLE: oil change on the EV', () =>
    expectCode({ vehicleId: 'VEH-02', serviceTypeCode: 'OIL_CHANGE' }, 422, 'SERVICE_NOT_APPLICABLE'));
  it('unknown dealership → 404', () => expectCode({ dealershipId: 'DLR-99' }, 404, 'NOT_FOUND'));
  it('unknown customer → 404', () => expectCode({ customerId: 'CUS-NOPE' }, 404, 'NOT_FOUND'));
  it('malformed body → 400 VALIDATION_ERROR', async () => {
    const res = await post(app, { ...bookingBody(), startTime: '10am' });
    expect(res.statusCode).toBe(400);
    expect(problem(res).code).toBe('VALIDATION_ERROR');
  });
});

describe('references', () => {
  it('use the dealership-local start date and a 4-digit sequence', async () => {
    const [v] = await addVehicles(t.db, 1);
    const res = await post(app, bookingBody({ vehicleId: v!, date: '2026-10-16', startTime: '08:00' }));
    expect(res.json().reference).toMatch(/^APT-20261016-\d{4}$/);
    expect(await t.db.select().from(vehicles).where(eq(vehicles.id, v!))).toHaveLength(1);
  });
});
