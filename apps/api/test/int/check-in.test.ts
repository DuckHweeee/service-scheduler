import { randomUUID } from 'node:crypto';
import { AppointmentDetail, paths, Problem } from '@scheduler/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manualClock } from '../../src/clock.js';
import { appointmentParts, appointments, inventory, vehicles } from '../../src/db/schema.js';
import { buildTestApp, createTestDb, seedReference, type TestDb } from '../helpers/index.js';

const clock = manualClock('2026-10-08T09:10:00+07:00');
let t: TestDb;
let app: FastifyInstance;
let seq = 0;

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

const addVehicle = async () => {
  seq += 1;
  const id = `VEH-CI${String(seq).padStart(3, '0')}`;
  await t.db.insert(vehicles).values({
    id,
    customerId: 'CUS-10482',
    modelYear: 2022,
    modelName: 'Crossover LX',
    powertrain: 'ICE',
    vin: `CIVIN${String(seq).padStart(12, '0')}`,
    plate: null,
  });
  return id;
};

/** Insert a CONFIRMED appointment directly (windows are chosen so they never collide). */
const seedAppt = async (o: { channel: 'SAME_DAY' | 'ADVANCE'; date?: string; from: string; tech?: string; bay?: string }) => {
  seq += 1;
  const date = o.date ?? '2026-10-08';
  const startAt = new Date(`${date}T${o.from}:00+07:00`);
  const reference = `APT-${date.replaceAll('-', '')}-8${String(seq).padStart(3, '0')}`;
  await t.db.insert(appointments).values({
    reference,
    channel: o.channel,
    customerId: 'CUS-10482',
    vehicleId: await addVehicle(),
    dealershipId: 'DLR-01',
    serviceTypeCode: 'GENERAL_INSPECTION',
    technicianId: o.tech ?? 'TEC-01',
    serviceBayId: o.bay ?? 'BAY-03',
    startAt,
    endAt: new Date(startAt.getTime() + 30 * 60_000),
    durationMin: 30,
    bookingSessionId: randomUUID(),
  });
  return reference;
};

const checkIn = (ref: string) => app.inject({ method: 'POST', url: paths.checkIn(ref) });
const rowOf = async (ref: string) => (await t.db.select().from(appointments).where(eq(appointments.reference, ref)))[0]!;

const bookOil = async (startTime: string) => {
  clock.set('2026-10-08T09:10:00+07:00');
  const body = {
    customerId: 'CUS-10482',
    vehicleId: await addVehicle(),
    dealershipId: 'DLR-01',
    serviceTypeCode: 'OIL_CHANGE',
    date: '2026-10-08',
    startTime,
    bookingSessionId: randomUUID(),
  };
  const res = await app.inject({ method: 'POST', url: paths.appointments, payload: body });
  expect(res.statusCode, res.body).toBe(201);
  return { body, ref: AppointmentDetail.parse(res.json()).reference };
};

describe('POST /appointments/{reference}/check-in', () => {
  it('same-day booked 11:30, check-in at 11:40 → 200 CHECKED_IN; second check-in → 409 APPOINTMENT_NOT_ACTIVE', async () => {
    const { ref } = await bookOil('11:30');

    clock.set('2026-10-08T11:40:00+07:00');
    const res = await checkIn(ref);
    expect(res.statusCode, res.body).toBe(200);
    const detail = AppointmentDetail.parse(res.json());
    expect(detail.status).toBe('CONFIRMED');
    expect(detail.checkedInAt).toBe('2026-10-08T11:40:00+07:00');
    expect(detail.history.at(-1)).toMatchObject({ type: 'CHECKED_IN', summary: 'Checked in' });

    const again = await checkIn(ref);
    expect(again.statusCode).toBe(409);
    expect(Problem.parse(again.json()).code).toBe('APPOINTMENT_NOT_ACTIVE');
  });

  it('same-day at start + 16 min → 409 LATE_ARRIVAL, NO_SHOW, parts released, window bookable again', async () => {
    const { body, ref } = await bookOil('14:00');
    const appt = await rowOf(ref);
    const reservedOf = async (sku: string) =>
      (await t.db.select().from(inventory).where(and(eq(inventory.dealershipId, 'DLR-01'), eq(inventory.sku, sku))))[0]!.reserved;
    const reservedWhileBooked = await reservedOf('OIL-5W30-4L');
    expect(reservedWhileBooked).toBeGreaterThan(0);

    clock.set('2026-10-08T14:16:00+07:00');
    const res = await checkIn(ref);
    expect(res.statusCode, res.body).toBe(409);
    const problem = Problem.parse(res.json());
    expect(problem.code).toBe('LATE_ARRIVAL');
    expect(problem.detail).toBe(
      'Arrived 16 minutes after the 14:00 start; same-day bookings are released after 15 minutes.',
    );

    expect((await rowOf(ref)).status).toBe('NO_SHOW');
    const lines = await t.db.select().from(appointmentParts).where(eq(appointmentParts.appointmentId, appt.id));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.releasedAt !== null)).toBe(true);
    expect(
      await t.db
        .select()
        .from(appointmentParts)
        .where(and(eq(appointmentParts.appointmentId, appt.id), isNull(appointmentParts.releasedAt))),
    ).toHaveLength(0);
    expect(await reservedOf('OIL-5W30-4L')).toBe(reservedWhileBooked - 1);

    const detail = AppointmentDetail.parse((await app.inject({ method: 'GET', url: paths.appointment(ref) })).json());
    expect(detail.status).toBe('NO_SHOW');
    expect(detail.history.at(-1)).toMatchObject({
      type: 'APPOINTMENT_NO_SHOW',
      summary: 'Released: not checked in within 15 minutes',
    });

    // the same window is bookable again (quota cap 1 would otherwise block it)
    clock.set('2026-10-08T09:10:00+07:00');
    const rebook = await app.inject({
      method: 'POST',
      url: paths.appointments,
      payload: { ...body, vehicleId: await addVehicle(), bookingSessionId: randomUUID() },
    });
    expect(rebook.statusCode, rebook.body).toBe(201);
  });

  it('exactly at start + 15 min → still allowed (grace is inclusive); +15:01 is not', async () => {
    const onTime = await seedAppt({ channel: 'SAME_DAY', from: '08:00' });
    clock.set('2026-10-08T08:15:00+07:00');
    expect((await checkIn(onTime)).statusCode).toBe(200);

    const late = await seedAppt({ channel: 'SAME_DAY', from: '09:00' });
    clock.set('2026-10-08T09:15:01+07:00');
    const res = await checkIn(late);
    expect(res.statusCode).toBe(409);
    expect(Problem.parse(res.json()).code).toBe('LATE_ARRIVAL');
  });

  it('early check-in is allowed', async () => {
    const ref = await seedAppt({ channel: 'SAME_DAY', from: '10:00' });
    clock.set('2026-10-08T09:30:00+07:00');
    expect((await checkIn(ref)).statusCode).toBe(200);
  });

  it('advance booking checked in at start + 30 → 200', async () => {
    const ref = await seedAppt({ channel: 'ADVANCE', date: '2026-10-09', from: '10:00' });
    clock.set('2026-10-09T10:30:00+07:00');
    const res = await checkIn(ref);
    expect(res.statusCode, res.body).toBe(200);
    expect(AppointmentDetail.parse(res.json()).checkedInAt).toBe('2026-10-09T10:30:00+07:00');
  });

  it('cancelled / NO_SHOW appointment → 409 APPOINTMENT_NOT_ACTIVE', async () => {
    const cancelled = await seedAppt({ channel: 'ADVANCE', date: '2026-10-12', from: '10:00' });
    await t.db.update(appointments).set({ status: 'CANCELLED' }).where(eq(appointments.reference, cancelled));
    const noShow = await seedAppt({ channel: 'SAME_DAY', from: '12:00' });
    await t.db.update(appointments).set({ status: 'NO_SHOW' }).where(eq(appointments.reference, noShow));
    clock.set('2026-10-08T12:05:00+07:00');
    for (const ref of [cancelled, noShow]) {
      const res = await checkIn(ref);
      expect(res.statusCode).toBe(409);
      expect(Problem.parse(res.json()).code).toBe('APPOINTMENT_NOT_ACTIVE');
    }
  });

  it('unknown reference → 404', async () => {
    expect((await checkIn('APT-20261008-0000')).statusCode).toBe(404);
  });
});
