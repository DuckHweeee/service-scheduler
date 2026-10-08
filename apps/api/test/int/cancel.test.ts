import { randomUUID } from 'node:crypto';
import { AppointmentDetail, paths, Problem, type CreateAppointmentRequest } from '@scheduler/contracts';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manualClock } from '../../src/clock.js';
import type { Db } from '../../src/db/client.js';
import { appointmentParts, appointments, inventory, vehicles } from '../../src/db/schema.js';
import { buildTestApp, createTestDb, seedReference, type TestDb } from '../helpers/index.js';

const clock = manualClock('2026-10-08T09:10:00+07:00');
let t: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  t = await createTestDb();
  await seedReference(t.db);
  app = await buildTestApp({ db: t.db, clock });
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

// ---- end helpers ----


const cancel = (reference: string, payload?: object) =>
  app.inject({ method: 'POST', url: paths.cancelAppointment(reference), ...(payload ? { payload } : {}) });

const book = async (o: Partial<CreateAppointmentRequest> = {}) => {
  const [vehicleId] = await addVehicles(t.db, 1);
  const res = await post(app, bookingBody({ vehicleId: vehicleId!, ...o }));
  expect(res.statusCode, res.body).toBe(201);
  return AppointmentDetail.parse(res.json());
};

describe('POST /appointments/{reference}/cancel', () => {
  it('cancels a future appointment, records the event, and frees the window for a re-book', async () => {
    const first = await book({ date: '2026-10-12', startTime: '10:00' });
    // fill the only other BRAKES tech so the window is genuinely full
    await occupy(t.db, { tech: 'TEC-01', bay: 'BAY-03', date: '2026-10-12', from: '08:00', to: '17:00' });
    const [v2] = await addVehicles(t.db, 1);
    const blocked = await post(app, bookingBody({ vehicleId: v2!, date: '2026-10-12', startTime: '10:00' }));
    expect(blocked.statusCode).toBe(409);

    const res = await cancel(first.reference, { reason: 'Plans changed' });
    expect(res.statusCode).toBe(200);
    const detail = AppointmentDetail.parse(res.json());
    expect(detail).toMatchObject({ status: 'CANCELLED' });
    expect(detail.cancelledAt).toBe('2026-10-08T09:10:00+07:00');
    const last = detail.history.at(-1)!;
    expect(last).toMatchObject({ type: 'APPOINTMENT_CANCELLED', summary: 'Cancelled by customer: Plans changed' });

    const rebook = await post(app, bookingBody({ vehicleId: v2!, date: '2026-10-12', startTime: '10:00' }));
    expect(rebook.statusCode).toBe(201);
    expect(rebook.json().technician.id).toBe(first.technician.id);
  });

  it('cancel without a body works; summary has no reason', async () => {
    const a = await book({ date: '2026-10-13' });
    const res = await cancel(a.reference);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().history.at(-1).summary).toBe('Cancelled by customer');
  });

  it('double cancel → 200, unchanged, no second event', async () => {
    const a = await book({ date: '2026-10-14' });
    const one = await cancel(a.reference);
    const two = await cancel(a.reference);
    expect(one.statusCode).toBe(200);
    expect(two.statusCode).toBe(200);
    expect(two.json().cancelledAt).toBe(one.json().cancelledAt);
    expect(two.json().history.filter((h: { type: string }) => h.type === 'APPOINTMENT_CANCELLED')).toHaveLength(1);
  });

  it('concurrent double cancel releases parts once', async () => {
    clock.set('2026-10-08T09:10:00+07:00');
    const a = await book({ serviceTypeCode: 'OIL_CHANGE', date: '2026-10-08', startTime: '13:00', dealershipId: 'DLR-03' });
    const [oil] = await t.db.select().from(inventory).where(and(eq(inventory.dealershipId, 'DLR-03'), eq(inventory.sku, 'OIL-5W30-4L')));
    expect(oil!.reserved).toBe(1);
    const results = await Promise.all([cancel(a.reference), cancel(a.reference), cancel(a.reference)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    const [after] = await t.db.select().from(inventory).where(and(eq(inventory.dealershipId, 'DLR-03'), eq(inventory.sku, 'OIL-5W30-4L')));
    expect(after!.reserved).toBe(0);
  });

  it('same-day cancel releases reserved parts (released_at set)', async () => {
    clock.set('2026-10-08T09:10:00+07:00');
    const a = await book({ serviceTypeCode: 'OIL_CHANGE', date: '2026-10-08', startTime: '11:30' });
    expect(a.parts).toHaveLength(2);
    const reservedBefore = (await t.db.select().from(inventory).where(and(eq(inventory.dealershipId, 'DLR-01'), eq(inventory.sku, 'OIL-5W30-4L'))))[0]!.reserved;
    expect(reservedBefore).toBe(1);
    const res = await cancel(a.reference);
    expect(res.statusCode).toBe(200);
    const lines = await t.db.select().from(appointmentParts);
    const mine = lines.filter((l) => l.releasedAt !== null);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    const after = (await t.db.select().from(inventory).where(and(eq(inventory.dealershipId, 'DLR-01'), eq(inventory.sku, 'OIL-5W30-4L'))))[0]!;
    expect(after.reserved).toBe(0);
    // the same-day quota slot is free again
    const [v] = await addVehicles(t.db, 1);
    const again = await post(app, bookingBody({ vehicleId: v!, serviceTypeCode: 'OIL_CHANGE', date: '2026-10-08', startTime: '11:30' }));
    expect(again.statusCode).toBe(201);
  });

  it('a started/past appointment → 409 APPOINTMENT_NOT_CANCELLABLE', async () => {
    clock.set('2026-10-08T09:10:00+07:00');
    const a = await book({ serviceTypeCode: 'GENERAL_INSPECTION', date: '2026-10-08', startTime: '14:00', dealershipId: 'DLR-02' });
    clock.set('2026-10-08T14:05:00+07:00');
    const res = await cancel(a.reference);
    expect(res.statusCode).toBe(409);
    expect(Problem.parse(res.json()).code).toBe('APPOINTMENT_NOT_CANCELLABLE');
    clock.set('2026-10-08T09:10:00+07:00');
  });

  it('a NO_SHOW appointment → 409', async () => {
    const a = await book({ date: '2026-10-15' });
    await t.db.update(appointments).set({ status: 'NO_SHOW' }).where(eq(appointments.reference, a.reference));
    const res = await cancel(a.reference);
    expect(res.statusCode).toBe(409);
    expect(Problem.parse(res.json()).code).toBe('APPOINTMENT_NOT_CANCELLABLE');
  });

  it('unknown reference → 404; malformed reference → 400', async () => {
    expect((await cancel('APT-20261012-9999')).statusCode).toBe(404);
    expect((await cancel('nope')).statusCode).toBe(400);
  });
});
