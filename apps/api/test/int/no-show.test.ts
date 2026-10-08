import { randomUUID } from 'node:crypto';
import { paths } from '@scheduler/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manualClock } from '../../src/clock.js';
import { appointments, bookingEvents, vehicles } from '../../src/db/schema.js';
import { releaseLateSameDay, startNoShowSweeper } from '../../src/services/no-show-sweeper.js';
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

const seedAppt = async (o: {
  channel: 'SAME_DAY' | 'ADVANCE';
  from: string;
  date?: string;
  bay: string;
  tech: string;
  status?: 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW';
  checkedInAt?: Date;
}) => {
  seq += 1;
  const date = o.date ?? '2026-10-08';
  const vehicleId = `VEH-NS${String(seq).padStart(3, '0')}`;
  await t.db.insert(vehicles).values({
    id: vehicleId,
    customerId: 'CUS-10482',
    modelYear: 2022,
    modelName: 'Crossover LX',
    powertrain: 'ICE',
    vin: `NSVIN${String(seq).padStart(12, '0')}`,
    plate: null,
  });
  const startAt = new Date(`${date}T${o.from}:00+07:00`);
  const reference = `APT-${date.replaceAll('-', '')}-7${String(seq).padStart(3, '0')}`;
  await t.db.insert(appointments).values({
    reference,
    channel: o.channel,
    status: o.status ?? 'CONFIRMED',
    customerId: 'CUS-10482',
    vehicleId,
    dealershipId: 'DLR-01',
    serviceTypeCode: 'GENERAL_INSPECTION',
    technicianId: o.tech,
    serviceBayId: o.bay,
    startAt,
    endAt: new Date(startAt.getTime() + 30 * 60_000),
    durationMin: 30,
    bookingSessionId: randomUUID(),
    checkedInAt: o.checkedInAt ?? null,
  });
  return reference;
};

const rowOf = async (ref: string) => (await t.db.select().from(appointments).where(eq(appointments.reference, ref)))[0]!;
const eventCount = async (ref: string, type: string) => {
  const row = await rowOf(ref);
  const events = await t.db.select().from(bookingEvents).where(eq(bookingEvents.appointmentId, row.id));
  return events.filter((e) => e.type === type).length;
};

describe('releaseLateSameDay', () => {
  it('marks only CONFIRMED, unchecked, same-day, past-grace rows; idempotent on a second run', async () => {
    clock.set('2026-10-08T10:00:00+07:00');
    const late = await seedAppt({ channel: 'SAME_DAY', from: '09:00', bay: 'BAY-01', tech: 'TEC-01' });
    const late2 = await seedAppt({ channel: 'SAME_DAY', from: '09:30', bay: 'BAY-02', tech: 'TEC-02' });
    const boundary = await seedAppt({ channel: 'SAME_DAY', from: '09:45', bay: 'BAY-03', tech: 'TEC-03' });
    const inGrace = await seedAppt({ channel: 'SAME_DAY', from: '09:50', bay: 'BAY-04', tech: 'TEC-04' });
    const advance = await seedAppt({ channel: 'ADVANCE', from: '06:00', bay: 'BAY-05', tech: 'TEC-01' });
    const checkedIn = await seedAppt({
      channel: 'SAME_DAY',
      from: '07:00',
      bay: 'BAY-01',
      tech: 'TEC-01',
      checkedInAt: new Date('2026-10-08T07:05:00+07:00'),
    });
    const cancelled = await seedAppt({ channel: 'SAME_DAY', from: '07:00', bay: 'BAY-02', tech: 'TEC-02', status: 'CANCELLED' });

    const first = await releaseLateSameDay(t.db, clock);
    expect([...first.released].sort()).toEqual([late, late2].sort());
    expect((await rowOf(late)).status).toBe('NO_SHOW');
    expect((await rowOf(late2)).status).toBe('NO_SHOW');
    for (const ref of [boundary, inGrace, advance, checkedIn]) expect((await rowOf(ref)).status).toBe('CONFIRMED');
    expect((await rowOf(cancelled)).status).toBe('CANCELLED');
    expect(await eventCount(late, 'APPOINTMENT_NO_SHOW')).toBe(1);

    const second = await releaseLateSameDay(t.db, clock);
    expect(second.released).toEqual([]);
    expect(await eventCount(late, 'APPOINTMENT_NO_SHOW')).toBe(1);

    // exactly start + 15 min is still in grace; one second later it is released
    clock.set('2026-10-08T10:00:01+07:00');
    expect((await releaseLateSameDay(t.db, clock)).released).toEqual([boundary]);
  });

  it('a check-in racing the sweeper ends in exactly one outcome', async () => {
    const ref = await seedAppt({ channel: 'SAME_DAY', from: '13:00', bay: 'BAY-01', tech: 'TEC-01' });
    // check-in sees 13:15 (in grace); the sweeper sees 13:16 (late)
    const checkInClock = manualClock('2026-10-08T13:15:00+07:00');
    const sweepClock = manualClock('2026-10-08T13:16:00+07:00');
    const racingApp = await buildTestApp({ db: t.db, clock: checkInClock });
    await racingApp.ready();
    try {
      const [res, sweep] = await Promise.all([
        racingApp.inject({ method: 'POST', url: paths.checkIn(ref) }),
        releaseLateSameDay(t.db, sweepClock),
      ]);
      const row = await rowOf(ref);
      if (res.statusCode === 200) {
        expect(sweep.released).not.toContain(ref);
        expect(row.status).toBe('CONFIRMED');
        expect(row.checkedInAt).not.toBeNull();
      } else {
        expect(res.statusCode).toBe(409);
        expect(res.json().code).toBe('APPOINTMENT_NOT_ACTIVE');
        expect(sweep.released).toContain(ref);
        expect(row.status).toBe('NO_SHOW');
        expect(row.checkedInAt).toBeNull();
      }
      expect((await eventCount(ref, 'CHECKED_IN')) + (await eventCount(ref, 'APPOINTMENT_NO_SHOW'))).toBe(1);
    } finally {
      await racingApp.close();
    }
  });
});

describe('startNoShowSweeper', () => {
  it('runs on an interval and stops cleanly', async () => {
    clock.set('2026-10-08T16:00:00+07:00');
    const ref = await seedAppt({ channel: 'SAME_DAY', from: '15:00', bay: 'BAY-02', tech: 'TEC-02' });
    const stop = startNoShowSweeper({ db: t.db, clock, intervalMs: 20 });
    try {
      await expect.poll(async () => (await rowOf(ref)).status, { timeout: 3000, interval: 25 }).toBe('NO_SHOW');
    } finally {
      stop();
    }
  });
});
