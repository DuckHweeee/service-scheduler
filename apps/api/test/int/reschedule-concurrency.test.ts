import { randomUUID } from 'node:crypto';
import { paths, Problem, type CreateAppointmentRequest } from '@scheduler/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock.js';
import { appointments, bookingEvents, inventory, vehicles } from '../../src/db/schema.js';
import { buildTestApp, createTestDb, seedReference, type TestDb } from '../helpers/index.js';

// ADR-006: reschedules take the old and the new dealership-day lock in ascending key order; the exclusion
// constraints stay the backstop. Each describe gets its own database so the 20 working days of the booking horizon
// (Fri 2026-10-09 … Fri 2026-11-06) can be reused. Real parallelism: Promise.all over app.inject on a pg pool.
const WORKING_DAYS = [
  '2026-10-09',
  '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16',
  '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
  '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30',
  '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
];

interface Ctx {
  t: TestDb;
  app: FastifyInstance;
}

const setup = (): Ctx => {
  const ctx = {} as Ctx;
  beforeAll(async () => {
    ctx.t = await createTestDb();
    await seedReference(ctx.t.db);
    ctx.app = await buildTestApp({ db: ctx.t.db, clock: fixedClock('2026-10-08T09:10:00+07:00') });
    await ctx.app.ready();
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.t.cleanup();
  });
  return ctx;
};

let seq = 0;
const newVehicle = async (t: TestDb) => {
  seq += 1;
  const id = `VEH-C${String(seq).padStart(4, '0')}`;
  await t.db.insert(vehicles).values({
    id,
    customerId: 'CUS-10482',
    modelYear: 2022,
    modelName: 'Crossover LX',
    powertrain: 'ICE',
    vin: `XVIN${String(seq).padStart(13, '0')}`,
    plate: null,
  });
  return id;
};

/** A CONFIRMED brake job (2 h) inserted directly. */
const seedBrake = async (t: TestDb, o: { date: string; from: string; to: string; tech: string; bay: string }) => {
  seq += 1;
  const vehicleId = await newVehicle(t);
  const reference = `APT-${o.date.replaceAll('-', '')}-8${String(seq).padStart(3, '0')}`;
  const startAt = new Date(`${o.date}T${o.from}:00+07:00`);
  const endAt = new Date(`${o.date}T${o.to}:00+07:00`);
  await t.db.insert(appointments).values({
    reference,
    channel: 'ADVANCE',
    customerId: 'CUS-10482',
    vehicleId,
    dealershipId: 'DLR-01',
    serviceTypeCode: 'BRAKE_PAD_REPLACEMENT',
    technicianId: o.tech,
    serviceBayId: o.bay,
    startAt,
    endAt,
    durationMin: (endAt.getTime() - startAt.getTime()) / 60_000,
  });
  return { reference, vehicleId };
};

/** TEC-01 busy all day: TEC-03 is the only free BRAKES technician, so the day holds one brake job at a time. */
const onlyTec03 = (t: TestDb, date: string) => seedBrake(t, { date, from: '08:00', to: '17:00', tech: 'TEC-01', bay: 'BAY-03' });

const resched = (app: FastifyInstance, reference: string, date: string, startTime: string) =>
  app.inject({ method: 'POST', url: paths.rescheduleAppointment(reference), payload: { date, startTime, bookingSessionId: randomUUID() } });

const bookBody = (vehicleId: string, date: string, startTime: string): CreateAppointmentRequest => ({
  customerId: 'CUS-10482',
  vehicleId,
  dealershipId: 'DLR-01',
  serviceTypeCode: 'BRAKE_PAD_REPLACEMENT',
  date,
  startTime,
  bookingSessionId: randomUUID(),
});

describe('R11 parallel reschedules into one window', () => {
  const c = setup();
  it('R11 20 appointments rescheduled in parallel into a capacity-1 window → exactly 1×200, 19×409, one row there', async () => {
    const target = '2026-10-09';
    await onlyTec03(c.t, target);
    const sources = WORKING_DAYS.slice(1); // 20 different days, one appointment each
    const appts = [];
    for (const day of sources) appts.push(await seedBrake(c.t, { date: day, from: '10:00', to: '12:00', tech: 'TEC-03', bay: 'BAY-01' }));

    const results = await Promise.all(appts.map((a) => resched(c.app, a.reference, target, '10:00')));
    const statuses = results.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(19);
    for (const r of results.filter((x) => x.statusCode === 409)) expect(Problem.parse(r.json()).code).toBe('SLOT_UNAVAILABLE');

    const inWindow = await c.t.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.status, 'CONFIRMED'), eq(appointments.startAt, new Date(`${target}T10:00:00+07:00`))));
    expect(inWindow).toHaveLength(1);
    expect(inWindow[0]!.technicianId).toBe('TEC-03');
    // the 19 losers did not move
    const stayed = await c.t.db.select().from(appointments).where(eq(appointments.status, 'CONFIRMED'));
    expect(stayed.filter((r) => r.technicianId === 'TEC-03')).toHaveLength(20);
  });
});

describe('R12 reschedule ∥ new booking', () => {
  const c = setup();
  it('R12 reschedule and a new booking into the same capacity-1 window: exactly one wins, 10 rounds', async () => {
    const targets = WORKING_DAYS.slice(0, 10);
    const sources = WORKING_DAYS.slice(10, 20);
    for (const [i, target] of targets.entries()) {
      await onlyTec03(c.t, target);
      const mover = await seedBrake(c.t, { date: sources[i]!, from: '10:00', to: '12:00', tech: 'TEC-03', bay: 'BAY-01' });
      const bookerVehicle = await newVehicle(c.t);
      const [rs, bk] = await Promise.all([
        resched(c.app, mover.reference, target, '10:00'),
        c.app.inject({ method: 'POST', url: paths.appointments, payload: bookBody(bookerVehicle, target, '10:00') }),
      ]);
      const okCount = [rs.statusCode === 200, bk.statusCode === 201].filter(Boolean).length;
      expect(okCount, `round ${i}: ${rs.statusCode}/${bk.statusCode}`).toBe(1);
      const loser = rs.statusCode === 200 ? bk : rs;
      expect(loser.statusCode).toBe(409);
      expect(Problem.parse(loser.json()).code).toBe('SLOT_UNAVAILABLE');
      const rows = await c.t.db
        .select()
        .from(appointments)
        .where(and(eq(appointments.status, 'CONFIRMED'), eq(appointments.startAt, new Date(`${target}T10:00:00+07:00`)), eq(appointments.technicianId, 'TEC-03')));
      expect(rows).toHaveLength(1);
    }
  });
});

describe('R13 crossing reschedules', () => {
  const c = setup();
  it('R13 A (day 1 → day 2) ∥ B (day 2 → day 1), 10 rounds: both complete, no deadlock', async () => {
    for (let i = 0; i < 10; i++) {
      const day1 = WORKING_DAYS[2 * i]!;
      const day2 = WORKING_DAYS[2 * i + 1]!;
      const a = await seedBrake(c.t, { date: day1, from: '10:00', to: '12:00', tech: 'TEC-03', bay: 'BAY-01' });
      const b = await seedBrake(c.t, { date: day2, from: '10:00', to: '12:00', tech: 'TEC-03', bay: 'BAY-01' });
      const [ra, rb] = await Promise.all([resched(c.app, a.reference, day2, '14:00'), resched(c.app, b.reference, day1, '14:00')]);
      expect(ra.statusCode, `round ${i} A ${ra.body}`).toBe(200);
      expect(rb.statusCode, `round ${i} B ${rb.body}`).toBe(200);
      const [rowA] = await c.t.db.select().from(appointments).where(eq(appointments.reference, a.reference));
      const [rowB] = await c.t.db.select().from(appointments).where(eq(appointments.reference, b.reference));
      expect(rowA!.startAt).toEqual(new Date(`${day2}T14:00:00+07:00`));
      expect(rowB!.startAt).toEqual(new Date(`${day1}T14:00:00+07:00`));
    }
  });
});

describe('R15b same appointment, two reschedules', () => {
  const c = setup();
  /**
   * Without help, one request often finishes before the other even reads the appointment, and the second then
   * (legitimately) moves it again. To force the interesting interleaving, an outside transaction holds the SOURCE-day
   * lock while both requests do their pre-transaction read, so both start from the same old slot and then queue.
   */
  const raceBehindSourceLock = async <T>(key: string, fire: () => [Promise<T>, Promise<T>]): Promise<[T, T]> => {
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const gotLock = new Promise<void>((r) => (locked = r));
    const holder = c.t.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}::text))`);
      locked();
      await held;
    });
    await gotLock;
    const pending = Promise.all(fire());
    await new Promise((r) => setTimeout(r, 300));
    release();
    await holder;
    return pending;
  };
  const eventsOf = async (reference: string) => {
    const [row] = await c.t.db.select().from(appointments).where(eq(appointments.reference, reference));
    const ev = await c.t.db.select().from(bookingEvents).where(eq(bookingEvents.appointmentId, row!.id));
    return { row: row!, resched: ev.filter((e) => e.type === 'APPOINTMENT_RESCHEDULED') };
  };

  it('R15b the same appointment rescheduled in parallel to two different days (10 rounds): exactly one 200, one 409 APPOINTMENT_NOT_RESCHEDULABLE, one APPOINTMENT_RESCHEDULED event, row at the winner’s slot', async () => {
    for (let i = 0; i < 10; i++) {
      const a = await seedBrake(c.t, { date: WORKING_DAYS[i]!, from: '10:00', to: '12:00', tech: 'TEC-03', bay: 'BAY-01' });
      const d2 = WORKING_DAYS[10 + i]!;
      const d3 = WORKING_DAYS[11 + i]!;
      const [r2, r3] = await raceBehindSourceLock(`DLR-01:${WORKING_DAYS[i]}`, () => [
        resched(c.app, a.reference, d2, '13:00'),
        resched(c.app, a.reference, d3, '13:00'),
      ]);
      const rs = [r2, r3];
      expect(rs.filter((r) => r.statusCode === 200), `round ${i}: ${r2.statusCode}/${r3.statusCode}`).toHaveLength(1);
      const loser = rs.find((r) => r.statusCode !== 200)!;
      expect(loser.statusCode).toBe(409);
      expect(Problem.parse(loser.json()).code).toBe('APPOINTMENT_NOT_RESCHEDULABLE');
      const winnerDay = r2.statusCode === 200 ? d2 : d3;
      const { row, resched: evs } = await eventsOf(a.reference);
      expect(evs).toHaveLength(1);
      expect(row.startAt).toEqual(new Date(`${winnerDay}T13:00:00+07:00`));
    }
  });

  it('R15b (SAME_DAY) today → two different later days: one winner, parts released exactly once', async () => {
    const stockOf = async (sku: string) =>
      (await c.t.db.select().from(inventory).where(and(eq(inventory.dealershipId, 'DLR-01'), eq(inventory.sku, sku))))[0]!.reserved;
    const before = [await stockOf('OIL-5W30-4L'), await stockOf('FLT-OIL-CX22')];
    for (let i = 0; i < 5; i++) {
      const vehicleId = await newVehicle(c.t);
      const booked = await c.app.inject({
        method: 'POST',
        url: paths.appointments,
        payload: { ...bookBody(vehicleId, '2026-10-08', '12:00'), serviceTypeCode: 'OIL_CHANGE' },
      });
      expect(booked.statusCode, booked.body).toBe(201);
      const reference = (booked.json() as { reference: string }).reference;
      expect([await stockOf('OIL-5W30-4L'), await stockOf('FLT-OIL-CX22')]).toEqual(before.map((n) => n + 1));
      const d2 = WORKING_DAYS[2 * i]!;
      const d3 = WORKING_DAYS[2 * i + 1]!;
      const [r2, r3] = await raceBehindSourceLock('DLR-01:2026-10-08', () => [
        resched(c.app, reference, d2, '10:00'),
        resched(c.app, reference, d3, '10:00'),
      ]);
      expect([r2.statusCode, r3.statusCode].sort(), `round ${i}`).toEqual([200, 409]);
      const loser = r2.statusCode === 200 ? r3 : r2;
      expect(Problem.parse(loser.json()).code).toBe('APPOINTMENT_NOT_RESCHEDULABLE');
      const { resched: evs } = await eventsOf(reference);
      expect(evs).toHaveLength(1);
      expect([await stockOf('OIL-5W30-4L'), await stockOf('FLT-OIL-CX22')]).toEqual(before);
    }
  });
});
