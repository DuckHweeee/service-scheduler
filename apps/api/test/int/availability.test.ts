import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AvailabilityResponse, Problem, paths } from '@scheduler/contracts';
import { fixedClock } from '../../src/clock.js';
import { getDealership, loadDayContext } from '../../src/db/repositories/index.js';
import { appointments } from '../../src/db/schema.js';
import { computeSlots } from '../../src/domain/availability/index.js';
import { toInstant } from '../../src/domain/time.js';
import { toServiceSpec } from '../../src/services/day-plan.js';
import { getServiceType } from '../../src/db/repositories/index.js';
import { buildTestApp, createTestDb, seedReference, type TestDb } from '../helpers/index.js';

// 2026-10-08 is a Thursday; 09:10 local (UTC+7).
const MORNING = '2026-10-08T09:10:00+07:00';

let t: TestDb;
const apps: FastifyInstance[] = [];
const appAt = async (iso: string) => {
  const a = await buildTestApp({ db: t.db, clock: fixedClock(iso) });
  apps.push(a);
  return a;
};
let app: FastifyInstance;

const get = async (a: FastifyInstance, dealership: string, service: string, date: string, vehicle = 'VEH-01') => {
  const res = await a.inject({
    method: 'GET',
    url: `${paths.availability(dealership)}?serviceType=${service}&date=${date}&vehicleId=${vehicle}`,
  });
  return res;
};
const ok = async (a: FastifyInstance, ...args: Parameters<typeof get> extends [unknown, ...infer R] ? R : never) => {
  const res = await get(a, ...(args as [string, string, string, string?]));
  expect(res.statusCode).toBe(200);
  return AvailabilityResponse.parse(res.json());
};

beforeAll(async () => {
  t = await createTestDb();
  await seedReference(t.db);
  app = await appAt(MORNING);
});
afterAll(async () => {
  for (const a of apps) await a.close();
  await t.cleanup();
});

describe('GET /dealerships/:id/availability', () => {
  it('golden: matches computeSlots on loadDayContext (with an existing booking)', async () => {
    // BAY-01 + TEC-03 busy 10:00–12:00 on Friday 2026-10-09 (brake pad job).
    await t.db.insert(appointments).values({
      reference: 'APT-20261009-0001',
      status: 'CONFIRMED',
      channel: 'ADVANCE',
      customerId: 'CUS-10001',
      vehicleId: 'VEH-01',
      dealershipId: 'DLR-01',
      serviceTypeCode: 'BRAKE_PAD_REPLACEMENT',
      technicianId: 'TEC-03',
      serviceBayId: 'BAY-01',
      startAt: toInstant('2026-10-09', 10 * 60, 'Asia/Ho_Chi_Minh'),
      endAt: toInstant('2026-10-09', 12 * 60, 'Asia/Ho_Chi_Minh'),
      durationMin: 120,
    });
    const body = await ok(app, 'DLR-01', 'BRAKE_PAD_REPLACEMENT', '2026-10-09');
    const dealership = (await getDealership(t.db, 'DLR-01'))!;
    const service = (await getServiceType(t.db, 'BRAKE_PAD_REPLACEMENT'))!;
    const day = await loadDayContext(t.db, dealership, '2026-10-09', { sameDay: null });
    const expected = computeSlots(day, toServiceSpec(service));

    expect(body.sameDay).toBeNull();
    expect(body.isWorkingDay).toBe(true);
    expect(body.durationMin).toBe(120);
    expect(body.slots).toHaveLength(expected.length);
    expect(body.slots.map((s) => [s.startTime, s.status])).toEqual(
      expected.map((s) => [`${String(Math.floor(s.start / 60)).padStart(2, '0')}:${String(s.start % 60).padStart(2, '0')}`, s.status]),
    );
    const at10 = body.slots.find((s) => s.startTime === '10:00')!;
    expect(at10.status).toBe('AVAILABLE');
    expect(at10.proposed?.technician.id).toBe('TEC-01'); // TEC-03 busy, TEC-01 the only other brake tech
    expect(at10.proposed?.serviceBay.id).toBe('BAY-02');
    expect(at10.startAt).toBe('2026-10-09T10:00:00+07:00');
    expect(at10.isExpress).toBe(false);
    expect(body.slots.every((s) => (s.status === 'AVAILABLE') === (s.proposed !== null))).toBe(true);
  });

  it('404 for unknown dealership / service / vehicle', async () => {
    for (const res of [
      await get(app, 'DLR-99', 'OIL_CHANGE', '2026-10-09'),
      await get(app, 'DLR-01', 'NOPE', '2026-10-09'),
      await get(app, 'DLR-01', 'OIL_CHANGE', '2026-10-09', 'VEH-99'),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(Problem.parse(res.json()).code).toBe('NOT_FOUND');
    }
  });

  it('date outside horizon → 422 OUTSIDE_BOOKING_HORIZON', async () => {
    for (const date of ['2026-10-07', '2026-11-08']) {
      const res = await get(app, 'DLR-01', 'OIL_CHANGE', date);
      expect(res.statusCode).toBe(422);
      expect(Problem.parse(res.json()).code).toBe('OUTSIDE_BOOKING_HORIZON');
    }
  });

  it('weekend → 200, isWorkingDay false, no slots, no sameDay', async () => {
    const body = await ok(app, 'DLR-01', 'OIL_CHANGE', '2026-10-10');
    expect(body).toMatchObject({ isWorkingDay: false, slots: [], sameDay: null });
  });

  it('DLR-03 + WHEEL_ALIGNMENT → every slot NO_QUALIFIED_TECHNICIAN', async () => {
    const body = await ok(app, 'DLR-03', 'WHEEL_ALIGNMENT', '2026-10-12');
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots.every((s) => s.status === 'NO_QUALIFIED_TECHNICIAN' && s.proposed === null)).toBe(true);
  });

  it('same-day oil change: first slot 11:30, express, quota cap 1', async () => {
    const body = await ok(app, 'DLR-01', 'OIL_CHANGE', '2026-10-08');
    expect(body.sameDay).toEqual({
      isSameDay: true,
      blocked: null,
      earliestStartTime: '11:30',
      leadTimeMin: 120,
      quotaCap: 1,
      lateGraceMin: 15,
    });
    expect(body.slots[0]).toMatchObject({ startTime: '11:30', isExpress: true, status: 'AVAILABLE' });
    expect(body.slots.every((s) => s.isExpress)).toBe(true);
  });

  it('same-day blocks: not express, parts, past cutoff', async () => {
    const brake = await ok(app, 'DLR-01', 'BRAKE_PAD_REPLACEMENT', '2026-10-08');
    expect(brake.sameDay?.blocked).toBe('SERVICE_NOT_EXPRESS');
    expect(brake.slots).toEqual([]);

    const parts = await ok(app, 'DLR-02', 'OIL_CHANGE', '2026-10-08');
    expect(parts.sameDay?.blocked).toBe('PARTS_UNAVAILABLE');
    expect(parts.slots).toEqual([]);

    const late = await ok(await appAt('2026-10-08T15:20:00+07:00'), 'DLR-01', 'OIL_CHANGE', '2026-10-08');
    expect(late.sameDay?.blocked).toBe('PAST_CUTOFF');
    expect(late.slots).toEqual([]);
  });

  it('tomorrow → sameDay null', async () => {
    const body = await ok(app, 'DLR-01', 'OIL_CHANGE', '2026-10-09');
    expect(body.sameDay).toBeNull();
    expect(body.slots[0]).toMatchObject({ startTime: '08:00', isExpress: false });
  });

  it('OIL_CHANGE + EV vehicle → 422 SERVICE_NOT_APPLICABLE', async () => {
    const res = await get(app, 'DLR-01', 'OIL_CHANGE', '2026-10-09', 'VEH-02');
    expect(res.statusCode).toBe(422);
    expect(Problem.parse(res.json()).code).toBe('SERVICE_NOT_APPLICABLE');
  });

  it('malformed query → 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'GET', url: `${paths.availability('DLR-01')}?serviceType=OIL_CHANGE&date=oops` });
    expect(res.statusCode).toBe(400);
    const body = Problem.parse(res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors?.map((e) => e.path)).toEqual(expect.arrayContaining(['date', 'vehicleId']));
  });
});
