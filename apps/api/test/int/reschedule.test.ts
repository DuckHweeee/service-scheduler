import { randomUUID } from 'node:crypto';
import { AppointmentDetail, paths, Problem, type CreateAppointmentRequest } from '@scheduler/contracts';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock.js';
import type { Db } from '../../src/db/client.js';
import { appointmentParts, appointments, bookingEvents, inventory, vehicles } from '../../src/db/schema.js';
import { buildTestApp, createTestDb, seedReference, type TestDb } from '../helpers/index.js';

// SPEC §6.5 / ADR-006. Thursday 2026-10-08, 09:10 local: earliest same-day start is 11:30; same-day quota cap = 1.
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
const post = (payload: unknown) =>
  app.inject({ method: 'POST', url: paths.appointments, payload: payload as object });

const reschedule = (reference: string, o: { date: string; startTime: string; bookingSessionId?: string }) =>
  app.inject({
    method: 'POST',
    url: paths.rescheduleAppointment(reference),
    payload: { bookingSessionId: randomUUID(), ...o },
  });

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

/** Directly insert an appointment (default: a CONFIRMED background job). */
const seedAppt = async (
  db: Db,
  o: {
    tech: string;
    bay: string;
    date: string;
    from: string;
    to: string;
    dealership?: string;
    vehicleId?: string;
    checkedIn?: boolean;
  },
) => {
  const vehicleId = o.vehicleId ?? (await addVehicles(db, 1, 'VEH-B'))[0]!;
  seq += 1;
  const startAt = new Date(`${o.date}T${o.from}:00+07:00`);
  const endAt = new Date(`${o.date}T${o.to}:00+07:00`);
  const reference = `APT-${o.date.replaceAll('-', '')}-9${String(seq).padStart(3, '0')}`;
  await db.insert(appointments).values({
    reference,
    channel: 'ADVANCE',
    customerId: 'CUS-10482',
    vehicleId,
    dealershipId: o.dealership ?? 'DLR-01',
    serviceTypeCode: 'BRAKE_PAD_REPLACEMENT',
    technicianId: o.tech,
    serviceBayId: o.bay,
    startAt,
    endAt,
    durationMin: (endAt.getTime() - startAt.getTime()) / 60_000,
    checkedInAt: o.checkedIn ? new Date(`${o.date}T${o.from}:00+07:00`) : null,
  });
  return { reference, vehicleId };
};

/** Book through the API and return the detail. */
const book = async (o: Partial<CreateAppointmentRequest> = {}) => {
  const res = await post(bookingBody(o));
  expect(res.statusCode, res.body).toBe(201);
  return AppointmentDetail.parse(res.json());
};

const rowOf = async (reference: string) => {
  const [row] = await t.db.select().from(appointments).where(eq(appointments.reference, reference));
  return row!;
};

const eventTypesFor = async (sessionId: string) =>
  (await t.db.select({ type: bookingEvents.type }).from(bookingEvents).where(eq(bookingEvents.sessionId, sessionId)).orderBy(asc(bookingEvents.id))).map(
    (e) => e.type,
  );

const eventsOfAppointment = async (reference: string) => {
  const row = await rowOf(reference);
  return t.db.select().from(bookingEvents).where(eq(bookingEvents.appointmentId, row.id)).orderBy(asc(bookingEvents.id));
};

const stock = async (dealershipId: string, sku: string) => {
  const [row] = await t.db.select().from(inventory).where(and(eq(inventory.dealershipId, dealershipId), eq(inventory.sku, sku)));
  return row!;
};

/** Leaves TEC-03 as the only free BRAKES technician on `date` (TEC-01 busy all day on BAY-03). */
const onlyTec03 = (date: string) => seedAppt(t.db, { tech: 'TEC-01', bay: 'BAY-03', date, from: '08:00', to: '17:00' });
// ---- end helpers ----

describe('reschedule in place (SPEC §6.5)', () => {
  it('R1 advance brake 10:00 → next working day 13:00: same reference, new slot, event, old window bookable again', async () => {
    await onlyTec03('2026-10-09'); // TEC-03 is the only technician: the old window is contested
    await onlyTec03('2026-10-12');
    const booked = await book({ date: '2026-10-09', startTime: '10:00' });
    const [other] = await addVehicles(t.db, 1, 'VEH-R1');
    // the old window is taken: a second booking is refused
    expect((await post(bookingBody({ vehicleId: other!, date: '2026-10-09', startTime: '10:00' }))).statusCode).toBe(409);

    const session = randomUUID();
    const res = await reschedule(booked.reference, { date: '2026-10-12', startTime: '13:00', bookingSessionId: session });
    expect(res.statusCode, res.body).toBe(200);
    const detail = AppointmentDetail.parse(res.json());
    expect(detail).toMatchObject({
      reference: booked.reference,
      status: 'CONFIRMED',
      channel: 'ADVANCE',
      localDate: '2026-10-12',
      startTime: '13:00',
      endTime: '15:00',
      technician: { id: 'TEC-03' },
    });
    expect(detail.customer.id).toBe(booked.customer.id);

    const last = detail.history.at(-1)!;
    expect(last.type).toBe('APPOINTMENT_RESCHEDULED');
    expect(last.detail).toMatchObject({
      from: { date: '2026-10-09', startTime: '10:00', endTime: '12:00', technicianId: 'TEC-03', channel: 'ADVANCE' },
      to: { date: '2026-10-12', startTime: '13:00', endTime: '15:00', technicianId: 'TEC-03', channel: 'ADVANCE' },
    });
    expect(last.summary).toBe(
      `Rescheduled from Fri 9 Oct 10:00 to Mon 12 Oct 13:00 — ${detail.serviceBay.name}, Riya Patel`,
    );
    // history keeps the booking sentences; the reschedule's own SLOT_REQUESTED is not part of it
    expect(detail.history.map((h) => h.type)).toEqual([
      'SLOT_REQUESTED',
      'CHECK_PASSED',
      'RESOURCES_RESERVED',
      'APPOINTMENT_CREATED',
      'APPOINTMENT_RESCHEDULED',
    ]);
    expect(await eventTypesFor(session)).toEqual(['SLOT_REQUESTED', 'APPOINTMENT_RESCHEDULED']);

    // the old window is bookable again
    expect((await post(bookingBody({ vehicleId: other!, date: '2026-10-09', startTime: '10:00' }))).statusCode).toBe(201);
  });

  it('R2 brake 10:00 → 10:30 same day, only its own resources free: overlaps only itself', async () => {
    const date = '2026-10-13';
    await onlyTec03(date);
    const booked = await book({ date, startTime: '10:00' });
    const res = await reschedule(booked.reference, { date, startTime: '10:30' });
    expect(res.statusCode, res.body).toBe(200);
    const detail = AppointmentDetail.parse(res.json());
    expect(detail).toMatchObject({ startTime: '10:30', endTime: '12:30', technician: { id: 'TEC-03' } });
    expect(detail.history.at(-1)!.summary).toBe(`Rescheduled from 10:00 to 10:30 — ${detail.serviceBay.name}, Riya Patel`);
  });

  it('R3 non-working day / 16:00 for 120 min / 10:15 / beyond the horizon → 422, row unchanged, no events', async () => {
    const booked = await book({ date: '2026-10-14', startTime: '10:00' });
    const before = await rowOf(booked.reference);
    const cases: [string, string, string][] = [
      ['2026-10-10', '10:00', 'DEALERSHIP_CLOSED'],
      ['2026-10-15', '16:00', 'OUTSIDE_OPENING_HOURS'],
      ['2026-10-15', '10:15', 'MISALIGNED_START'],
      ['2026-12-01', '10:00', 'OUTSIDE_BOOKING_HORIZON'],
    ];
    for (const [date, startTime, code] of cases) {
      const session = randomUUID();
      const res = await reschedule(booked.reference, { date, startTime, bookingSessionId: session });
      expect(res.statusCode, `${code} ${res.body}`).toBe(422);
      expect(Problem.parse(res.json()).code).toBe(code);
      expect(await eventTypesFor(session)).toEqual([]);
    }
    expect(await rowOf(booked.reference)).toEqual(before);
  });

  it('R4 advance oil change → today 11:30: SAME_DAY, parts reserved and listed', async () => {
    const [vehicleId] = await addVehicles(t.db, 1, 'VEH-R4');
    const booked = await book({ vehicleId, serviceTypeCode: 'OIL_CHANGE', date: '2026-10-09', startTime: '10:00' });
    expect(booked.parts).toEqual([]);
    const oil = await stock('DLR-01', 'OIL-5W30-4L');
    const filter = await stock('DLR-01', 'FLT-OIL-CX22');

    const res = await reschedule(booked.reference, { date: TODAY, startTime: '11:30' });
    expect(res.statusCode, res.body).toBe(200);
    const detail = AppointmentDetail.parse(res.json());
    expect(detail).toMatchObject({ channel: 'SAME_DAY', localDate: TODAY, startTime: '11:30', endTime: '12:15' });
    expect(detail.parts).toEqual([
      { sku: 'FLT-OIL-CX22', name: 'Oil filter Crossover LX', qty: 1 },
      { sku: 'OIL-5W30-4L', name: 'Engine oil 5W-30 4L', qty: 1 },
    ]);
    expect((await stock('DLR-01', 'OIL-5W30-4L')).reserved).toBe(oil.reserved + 1);
    expect((await stock('DLR-01', 'FLT-OIL-CX22')).reserved).toBe(filter.reserved + 1);
    const lines = await t.db.select().from(appointmentParts).where(eq(appointmentParts.appointmentId, (await rowOf(booked.reference)).id));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.releasedAt === null)).toBe(true);
    expect(detail.history.at(-1)!.detail).toMatchObject({ from: { channel: 'ADVANCE' }, to: { channel: 'SAME_DAY' } });
  });

  it('R4b advance → today when the parts are out of stock → 409 PARTS_UNAVAILABLE, nothing changes', async () => {
    const booked = await book({ dealershipId: 'DLR-02', serviceTypeCode: 'OIL_CHANGE', date: '2026-10-09', startTime: '10:00' });
    const before = await rowOf(booked.reference);
    const stockBefore = await stock('DLR-02', 'OIL-5W30-4L');
    const res = await reschedule(booked.reference, { date: TODAY, startTime: '13:00' });
    expect(res.statusCode).toBe(409);
    expect(Problem.parse(res.json()).code).toBe('PARTS_UNAVAILABLE');
    expect(await rowOf(booked.reference)).toEqual(before);
    expect((await stock('DLR-02', 'OIL-5W30-4L')).reserved).toBe(stockBefore.reserved);
  });

  it('R5 same-day oil change → tomorrow: ADVANCE, parts released; and back to today re-reserves them', async () => {
    const [vehicleId] = await addVehicles(t.db, 1, 'VEH-R5');
    const booked = await book({ dealershipId: 'DLR-03', vehicleId, serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '12:00' });
    expect(booked.channel).toBe('SAME_DAY');
    const reservedWith = (await stock('DLR-03', 'OIL-5W30-4L')).reserved;
    const id = (await rowOf(booked.reference)).id;

    const res = await reschedule(booked.reference, { date: '2026-10-09', startTime: '10:00' });
    expect(res.statusCode, res.body).toBe(200);
    expect(AppointmentDetail.parse(res.json())).toMatchObject({ channel: 'ADVANCE', localDate: '2026-10-09' });
    expect((await stock('DLR-03', 'OIL-5W30-4L')).reserved).toBe(reservedWith - 1);
    const released = await t.db.select().from(appointmentParts).where(eq(appointmentParts.appointmentId, id));
    expect(released).toHaveLength(2);
    expect(released.every((l) => l.releasedAt !== null)).toBe(true);

    const back = await reschedule(booked.reference, { date: TODAY, startTime: '12:00' });
    expect(back.statusCode, back.body).toBe(200);
    expect((await stock('DLR-03', 'OIL-5W30-4L')).reserved).toBe(reservedWith);
    const again = await t.db.select().from(appointmentParts).where(eq(appointmentParts.appointmentId, id));
    expect(again.every((l) => l.releasedAt === null)).toBe(true);
  });

  it('R6 same-day oil change → later today with the stock exactly consumed by itself: own reservation kept', async () => {
    const [vehicleId] = await addVehicles(t.db, 1, 'VEH-R6');
    const booked = await book({ vehicleId, serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '14:00' });
    const skus = ['OIL-5W30-4L', 'FLT-OIL-CX22'];
    const reservedBefore: number[] = [];
    for (const sku of skus) {
      const s = await stock('DLR-01', sku);
      reservedBefore.push(s.reserved);
      await t.db.update(inventory).set({ onHand: s.reserved }).where(and(eq(inventory.dealershipId, 'DLR-01'), eq(inventory.sku, sku)));
    }
    try {
      const res = await reschedule(booked.reference, { date: TODAY, startTime: '15:00' });
      expect(res.statusCode, res.body).toBe(200);
      expect(AppointmentDetail.parse(res.json())).toMatchObject({ channel: 'SAME_DAY', startTime: '15:00' });
      for (const [i, sku] of skus.entries()) expect((await stock('DLR-01', sku)).reserved).toBe(reservedBefore[i]);
    } finally {
      for (const sku of skus) await t.db.update(inventory).set({ onHand: 10 }).where(and(eq(inventory.dealershipId, 'DLR-01'), eq(inventory.sku, sku)));
    }
  });

  it('R7 target window taken → 409 SLOT_UNAVAILABLE with reason and alternatives, CHECK_FAILED, row unchanged', async () => {
    const date = '2026-10-15';
    const booked = await book({ date: '2026-10-09', startTime: '14:00' });
    await seedAppt(t.db, { tech: 'TEC-01', bay: 'BAY-03', date, from: '08:00', to: '17:00' });
    await seedAppt(t.db, { tech: 'TEC-03', bay: 'BAY-02', date, from: '13:00', to: '15:00' });
    const before = await rowOf(booked.reference);
    const session = randomUUID();
    const res = await reschedule(booked.reference, { date, startTime: '13:00', bookingSessionId: session });
    expect(res.statusCode).toBe(409);
    const problem = Problem.parse(res.json());
    expect(problem.code).toBe('SLOT_UNAVAILABLE');
    expect(problem.reason).toBeDefined();
    expect(problem.alternatives!.length).toBeGreaterThan(0);
    expect(await eventTypesFor(session)).toEqual(['SLOT_REQUESTED', 'CHECK_FAILED']);
    expect(await rowOf(booked.reference)).toEqual(before);
  });

  it('R8 target overlaps the same vehicle’s other appointment → 409 VEHICLE_ALREADY_BOOKED', async () => {
    const [vehicleId] = await addVehicles(t.db, 1, 'VEH-R8');
    const a = await book({ vehicleId, serviceTypeCode: 'GENERAL_INSPECTION', date: '2026-10-16', startTime: '10:00' });
    const b = await book({ vehicleId, serviceTypeCode: 'GENERAL_INSPECTION', date: '2026-10-19', startTime: '10:00' });
    const before = await rowOf(b.reference);
    const res = await reschedule(b.reference, { date: '2026-10-16', startTime: '10:00' });
    expect(res.statusCode).toBe(409);
    expect(Problem.parse(res.json()).code).toBe('VEHICLE_ALREADY_BOOKED');
    expect(await rowOf(b.reference)).toEqual(before);
    // an adjacent window (starts exactly when the other one ends) is fine
    expect(a.endTime).toBe('10:30');
    expect((await reschedule(b.reference, { date: '2026-10-16', startTime: '10:30' })).statusCode).toBe(200);
  });

  it('R9 cancelled / checked-in / started appointment → 409 APPOINTMENT_NOT_RESCHEDULABLE', async () => {
    const cancelled = await book({ date: '2026-10-20', startTime: '10:00' });
    expect((await app.inject({ method: 'POST', url: paths.cancelAppointment(cancelled.reference), payload: {} })).statusCode).toBe(200);
    const checkedIn = await seedAppt(t.db, { tech: 'TEC-03', bay: 'BAY-02', date: '2026-10-21', from: '10:00', to: '12:00', checkedIn: true });
    const started = await seedAppt(t.db, { tech: 'TEC-03', bay: 'BAY-02', date: TODAY, from: '08:00', to: '10:00' });
    for (const reference of [cancelled.reference, checkedIn.reference, started.reference]) {
      const before = await rowOf(reference);
      const res = await reschedule(reference, { date: '2026-10-22', startTime: '10:00' });
      expect(res.statusCode, reference).toBe(409);
      expect(Problem.parse(res.json()).code).toBe('APPOINTMENT_NOT_RESCHEDULABLE');
      expect(await rowOf(reference)).toEqual(before);
    }
  });

  it('R10 target equals the current slot → 200 and no new event', async () => {
    const booked = await book({ date: '2026-10-22', startTime: '10:00' });
    const eventsBefore = (await eventsOfAppointment(booked.reference)).length;
    const session = randomUUID();
    const res = await reschedule(booked.reference, { date: '2026-10-22', startTime: '10:00', bookingSessionId: session });
    expect(res.statusCode, res.body).toBe(200);
    expect(AppointmentDetail.parse(res.json()).history).toEqual(booked.history);
    expect((await eventsOfAppointment(booked.reference)).length).toBe(eventsBefore);
    expect(await eventTypesFor(session)).toEqual([]);
  });

  it('R14 same-day quota cap 1 already used by this appointment; moving it within today → 200', async () => {
    const [vehicleId] = await addVehicles(t.db, 1, 'VEH-R14', 'Hatch GT');
    const booked = await book({ dealershipId: 'DLR-02', vehicleId, serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '12:00' });
    // a different customer's request in the overlapping window is refused: the quota is used up
    const [other] = await addVehicles(t.db, 1, 'VEH-R14', 'Hatch GT');
    const refused = await post(bookingBody({ dealershipId: 'DLR-02', vehicleId: other!, serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '12:30' }));
    expect(refused.statusCode).toBe(409);
    // ... but the owner may shift into it
    const res = await reschedule(booked.reference, { date: TODAY, startTime: '12:30' });
    expect(res.statusCode, res.body).toBe(200);
    expect(AppointmentDetail.parse(res.json())).toMatchObject({ channel: 'SAME_DAY', startTime: '12:30' });
  });

  it('R15 reschedule ∥ cancel of the same appointment: never inconsistent (10 rounds)', async () => {
    const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
    const outcomes = { moved: 0, refused: 0 };
    for (const [i, day] of days.entries()) {
      const [vehicleId] = await addVehicles(t.db, 1, 'VEH-R15');
      const booked = await book({ vehicleId, date: day, startTime: '10:00' });
      const target = days[(i + 1) % days.length]!;
      const [rs, cancel] = await Promise.all([
        reschedule(booked.reference, { date: target, startTime: '13:00' }),
        app.inject({ method: 'POST', url: paths.cancelAppointment(booked.reference), payload: {} }),
      ]);
      expect(cancel.statusCode, cancel.body).toBe(200);
      const row = await rowOf(booked.reference);
      expect(row.status).toBe('CANCELLED');
      const events = (await eventsOfAppointment(booked.reference)).map((e) => e.type);
      if (rs.statusCode === 200) {
        outcomes.moved += 1;
        expect(events).toContain('APPOINTMENT_RESCHEDULED');
        expect(row.startAt).toEqual(new Date(`${target}T13:00:00+07:00`));
      } else {
        outcomes.refused += 1;
        expect(rs.statusCode).toBe(409);
        expect(Problem.parse(rs.json()).code).toBe('APPOINTMENT_NOT_RESCHEDULABLE');
        expect(events).not.toContain('APPOINTMENT_RESCHEDULED');
        expect(row.startAt).toEqual(new Date(`${day}T10:00:00+07:00`));
      }
    }
    expect(outcomes.moved + outcomes.refused).toBe(10);
  });

  it('unknown reference → 404; malformed body → 400', async () => {
    const missing = await reschedule('APT-20261009-0000', { date: '2026-10-22', startTime: '10:00' });
    expect(missing.statusCode).toBe(404);
    expect(Problem.parse(missing.json()).code).toBe('NOT_FOUND');
    const bad = await app.inject({ method: 'POST', url: paths.rescheduleAppointment('APT-20261009-0001'), payload: { date: 'nope' } });
    expect(bad.statusCode).toBe(400);
    expect(Problem.parse(bad.json()).code).toBe('VALIDATION_ERROR');
  });

  it('/metrics exposes reschedule_attempts_total for a 200 and a 409', async () => {
    const booked = await book({ date: '2026-11-05', startTime: '09:00' });
    await seedAppt(t.db, { tech: 'TEC-01', bay: 'BAY-03', date: '2026-11-06', from: '08:00', to: '17:00' });
    await seedAppt(t.db, { tech: 'TEC-03', bay: 'BAY-02', date: '2026-11-06', from: '08:00', to: '17:00' });
    expect((await reschedule(booked.reference, { date: '2026-11-06', startTime: '10:00' })).statusCode).toBe(409);
    expect((await reschedule(booked.reference, { date: '2026-11-05', startTime: '13:00' })).statusCode).toBe(200);
    const text = (await app.inject({ method: 'GET', url: '/metrics' })).body;
    expect(text).toMatch(/reschedule_attempts_total\{outcome="rescheduled",reason="none"\} [1-9]/);
    expect(text).toMatch(/reschedule_attempts_total\{outcome="rejected",reason="[A-Z_]+"\} [1-9]/);
  });
});
