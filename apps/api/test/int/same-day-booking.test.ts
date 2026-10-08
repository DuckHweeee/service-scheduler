import { randomUUID } from 'node:crypto';
import { AppointmentDetail, paths, Problem, type CreateAppointmentRequest } from '@scheduler/contracts';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock.js';
import type { Db } from '../../src/db/client.js';
import { appointments, bookingEvents, inventory, vehicles } from '../../src/db/schema.js';
import { buildTestApp, createTestDb, seedReference, type TestDb } from '../helpers/index.js';

// Thursday 2026-10-08, 09:10 local: earliest same-day start is 11:30; DLR-01 quota cap = 1 (5 bays × 20%).
const TODAY = '2026-10-08';
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


const stock = async (dealershipId: string, sku: string) => {
  const [row] = await t.db
    .select()
    .from(inventory)
    .where(and(eq(inventory.dealershipId, dealershipId), eq(inventory.sku, sku)));
  return row!;
};

describe('same-day booking', () => {
  it('oil change at 11:30 → 201 SAME_DAY, reserves each part line, parts in the body', async () => {
    const oilBefore = await stock('DLR-01', 'OIL-5W30-4L');
    const filterBefore = await stock('DLR-01', 'FLT-OIL-CX22');
    const body = bookingBody({ serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '11:30' });
    const res = await post(app, body);
    expect(res.statusCode, res.body).toBe(201);
    const detail = AppointmentDetail.parse(res.json());
    expect(detail).toMatchObject({ channel: 'SAME_DAY', status: 'CONFIRMED', startTime: '11:30', endTime: '12:15' });
    expect(detail.parts).toEqual([
      { sku: 'FLT-OIL-CX22', name: 'Oil filter Crossover LX', qty: 1 },
      { sku: 'OIL-5W30-4L', name: 'Engine oil 5W-30 4L', qty: 1 },
    ]);
    expect((await stock('DLR-01', 'OIL-5W30-4L')).reserved).toBe(oilBefore.reserved + 1);
    expect((await stock('DLR-01', 'FLT-OIL-CX22')).reserved).toBe(filterBefore.reserved + 1);
    expect(detail.history.map((h) => h.summary)).toEqual([
      'Requested 11:30–12:15',
      expect.stringMatching(/^Check passed: Bay \d and .+ free 11:30–12:15$/),
      'Bay and technician reserved together · parts reserved',
      'Appointment record created · confirmation sent',
    ]);
  });

  it('brake today → 422 SERVICE_NOT_EXPRESS (no events)', async () => {
    const body = bookingBody({ date: TODAY, startTime: '13:00' });
    const res = await post(app, body);
    expect(res.statusCode).toBe(422);
    expect(Problem.parse(res.json()).code).toBe('SERVICE_NOT_EXPRESS');
    expect(await eventTypes(t.db, body.bookingSessionId)).toEqual([]);
  });

  it('oil change at 11:00 → 422 LEAD_TIME_NOT_MET', async () => {
    const res = await post(app, bookingBody({ serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '11:00' }));
    expect(res.statusCode).toBe(422);
    expect(Problem.parse(res.json()).code).toBe('LEAD_TIME_NOT_MET');
  });

  it('a start that has already passed → 422 LEAD_TIME_NOT_MET', async () => {
    const res = await post(app, bookingBody({ serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '08:00' }));
    expect(res.statusCode).toBe(422);
    expect(Problem.parse(res.json()).code).toBe('LEAD_TIME_NOT_MET');
  });

  it('DLR-02 oil change for the Crossover → 409 PARTS_UNAVAILABLE, nothing reserved, CHECK_FAILED recorded', async () => {
    const body = bookingBody({ dealershipId: 'DLR-02', serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '13:00' });
    const oilBefore = await stock('DLR-02', 'OIL-5W30-4L');
    const res = await post(app, body);
    expect(res.statusCode).toBe(409);
    expect(Problem.parse(res.json()).code).toBe('PARTS_UNAVAILABLE');
    expect(await eventTypes(t.db, body.bookingSessionId)).toEqual(['SLOT_REQUESTED', 'CHECK_FAILED']);
    expect((await stock('DLR-02', 'OIL-5W30-4L')).reserved).toBe(oilBefore.reserved);
  });

  it('a failed window check reserves no parts', async () => {
    // DLR-03 (same stock as DLR-01): block every GENERAL-skilled technician at 14:00 so the slot check fails.
    const BAYS: Record<string, string> = { 'TEC-09': 'BAY-11', 'TEC-10': 'BAY-12', 'TEC-11': 'BAY-13', 'TEC-12': 'BAY-14' };
    for (const tech of ['TEC-09', 'TEC-10', 'TEC-11', 'TEC-12']) {
      await occupy(t.db, { tech, bay: BAYS[tech]!, date: TODAY, from: '14:00', to: '15:00', dealership: 'DLR-03' });
    }
    const before = await stock('DLR-03', 'OIL-5W30-4L');
    const res = await post(app, bookingBody({ dealershipId: 'DLR-03', serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '14:00' }));
    expect(res.statusCode).toBe(409);
    expect(Problem.parse(res.json())).toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect((await stock('DLR-03', 'OIL-5W30-4L')).reserved).toBe(before.reserved);
  });
});

describe('same-day concurrency', () => {
  it('quota: 10 parallel overlapping same-day requests → exactly quotaCap (1) succeed', async () => {
    const dealershipId = 'DLR-02'; // untouched above; FLT-OIL-CX22 = 0 there, so use a model with generic parts
    const ids = await addVehicles(t.db, 10, 'VEH-Q', 'Hatch GT');
    const bodies = ids.map((vehicleId, i) =>
      bookingBody({ dealershipId, vehicleId, serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: i % 2 === 0 ? '12:00' : '12:30' }),
    );
    const results = await Promise.all(bodies.map((b) => post(app, b)));
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
    for (const r of results.filter((x) => x.statusCode === 409)) {
      expect(Problem.parse(r.json())).toMatchObject({ code: 'SLOT_UNAVAILABLE', reason: 'SAME_DAY_QUOTA_REACHED' });
    }
    expect(await confirmedCount(t.db, and(eq(appointments.dealershipId, dealershipId), eq(appointments.channel, 'SAME_DAY')))).toBe(1);
  });

  it('parts race: stock of 1, two parallel non-overlapping same-day oil changes → one 201, one 409 PARTS_UNAVAILABLE', async () => {
    const dealershipId = 'DLR-03';
    // DLR-03 morning is free (blocks above are 14:00-15:00 only); leave quota out of the picture with distinct windows
    await t.db.update(inventory).set({ onHand: 1 }).where(and(eq(inventory.dealershipId, dealershipId), eq(inventory.sku, 'FLT-OIL-GEN')));
    await t.db.update(inventory).set({ reserved: 0 }).where(and(eq(inventory.dealershipId, dealershipId), eq(inventory.sku, 'FLT-OIL-GEN')));
    const [a, b] = await addVehicles(t.db, 2, 'VEH-P', 'Hatch GT');
    const results = await Promise.all([
      post(app, bookingBody({ dealershipId, vehicleId: a!, serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '11:30' })),
      post(app, bookingBody({ dealershipId, vehicleId: b!, serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '16:00' })),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409]);
    const loser = results.find((r) => r.statusCode === 409)!;
    expect(Problem.parse(loser.json()).code).toBe('PARTS_UNAVAILABLE');
    const row = await stock(dealershipId, 'FLT-OIL-GEN');
    expect(row.reserved).toBe(1);
    expect(row.reserved).toBeLessThanOrEqual(row.onHand);
  });
});
