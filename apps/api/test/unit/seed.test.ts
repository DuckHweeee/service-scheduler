// Background-load seed with an injected FAKE engine (the real one is A2's). Uses a real database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { fixedClock } from '../../src/clock.js';
import type { ComputeSlots, SlotResult } from '../../src/domain/availability/types.js';
import { appointments, bookingEvents } from '../../src/db/schema.js';
import { mulberry32, resetDatabase, seedBackgroundLoad, seedReferenceData } from '../../src/db/seed/index.js';
import { createTestDb, type TestDb } from '../helpers/index.js';

/** Minimal first-fit engine: 30-min grid, first free eligible bay/tech by id. */
const fakeComputeSlots: ComputeSlots = (day, service, step = 30) => {
  if (!day.isWorkingDay) return [];
  const free = (busy: { start: number; end: number }[], s: number, e: number) =>
    !busy.some((b) => b.start < e && s < b.end);
  const out: SlotResult[] = [];
  for (let s = day.opensAt; s + service.durationMin <= day.closesAt; s += step) {
    const e = s + service.durationMin;
    const bay = day.bays.find((b) => service.allowedBayTypes.includes(b.bayType) && free(b.busy, s, e));
    const tech = day.technicians.find((x) => x.skills.includes(service.requiredSkill) && free(x.busy, s, e));
    out.push({
      start: s,
      end: e,
      status: bay && tech ? 'AVAILABLE' : 'FULLY_BOOKED',
      proposed: bay && tech ? { bayId: bay.id, technicianId: tech.id } : null,
    });
  }
  return out;
};

const clock = fixedClock('2026-10-08T09:10:00+07:00');
let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.cleanup());

const snapshot = async () =>
  (await t.db.select().from(appointments).orderBy(asc(appointments.reference))).map((a) => ({
    reference: a.reference,
    vehicle: a.vehicleId,
    tech: a.technicianId,
    bay: a.serviceBayId,
    dealership: a.dealershipId,
    start: a.startAt.toISOString(),
    end: a.endAt.toISOString(),
    service: a.serviceTypeCode,
  }));

const run = async () => {
  await resetDatabase(t.db);
  await seedReferenceData(t.db);
  return seedBackgroundLoad(t.db, { clock, rng: mulberry32(42), engine: { computeSlots: fakeComputeSlots } });
};

describe('seedBackgroundLoad (fake engine)', () => {
  it('produces ADVANCE/CONFIRMED rows with no bay, technician or vehicle overlap', async () => {
    const n = await run();
    expect(n).toBeGreaterThan(50);
    const rows = await t.db.select().from(appointments);
    expect(rows).toHaveLength(n);
    expect(rows.every((r) => r.channel === 'ADVANCE' && r.status === 'CONFIRMED')).toBe(true);
    expect(rows.every((r) => r.customerId !== 'CUS-10482')).toBe(true);

    for (const key of ['serviceBayId', 'technicianId', 'vehicleId'] as const) {
      const groups = new Map<string, typeof rows>();
      for (const r of rows) groups.set(r[key], [...(groups.get(r[key]) ?? []), r]);
      for (const list of groups.values()) {
        const sorted = [...list].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i]!.startAt.getTime()).toBeGreaterThanOrEqual(sorted[i - 1]!.endAt.getTime());
        }
      }
    }
  });

  it('stays within opening hours, on working days, never in the past, over ~11 days', async () => {
    const rows = await t.db.select().from(appointments);
    for (const r of rows) {
      const local = new Date(r.startAt.getTime() + 7 * 3_600_000); // UTC+7, no DST
      const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
      expect(mins).toBeGreaterThanOrEqual(480);
      expect(mins + r.durationMin).toBeLessThanOrEqual(1020);
      expect([1, 2, 3, 4, 5]).toContain(local.getUTCDay());
      expect(r.startAt.getTime()).toBeGreaterThan(clock.now().getTime());
    }
    const dates = new Set(rows.map((r) => r.reference.slice(4, 12)));
    expect(dates.size).toBe(11);
  });

  it('inserts one APPOINTMENT_CREATED event per appointment with detail.seeded', async () => {
    const events = await t.db.select().from(bookingEvents).where(eq(bookingEvents.type, 'APPOINTMENT_CREATED'));
    const rows = await t.db.select().from(appointments);
    expect(events).toHaveLength(rows.length);
    expect(events.every((e) => (e.detail as { seeded?: boolean }).seeded === true)).toBe(true);
    expect(new Set(events.map((e) => e.appointmentId)).size).toBe(rows.length);
  });

  it('is deterministic for a fixed clock and seed', async () => {
    const first = await snapshot();
    await run();
    const second = await snapshot();
    expect(second).toEqual(first);
  });

  it('surfaces the stub error when the real engine is not implemented yet', async () => {
    await resetDatabase(t.db);
    await seedReferenceData(t.db);
    await expect(
      seedBackgroundLoad(t.db, {
        clock,
        rng: mulberry32(42),
        engine: {
          computeSlots: () => {
            throw new Error('availability.computeSlots not implemented (Wave 1 / A2)');
          },
        },
      }),
    ).rejects.toThrow(/not implemented/);
  });
});
