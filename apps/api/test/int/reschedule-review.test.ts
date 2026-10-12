import { randomUUID } from 'node:crypto';
import { AppointmentDetail, AvailabilityResponse, paths, Problem } from '@scheduler/contracts';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock, manualClock } from '../../src/clock.js';
import { appointmentParts, appointments, bookingEvents, inventory, vehicles } from '../../src/db/schema.js';
import { releaseLateSameDay } from '../../src/services/no-show-sweeper.js';
import { buildTestApp, createTestDb, seedReference, type TestDb } from '../helpers/index.js';

// W5-Q2: independent adversarial review of reschedule (SPEC §6.5, ADR-006). Everything here is ADDITIVE to R1-R15b.
// The three defects it found (Q2-D1..D3) were fixed by Opus; their tests now guard the fix (see docs/ai-log.md W5-Q2).
// Fixed clock: Thursday 2026-10-08 09:10 (+07:00) unless a describe says otherwise. Same-day earliest start 11:30, quota cap 1.
const TODAY = '2026-10-08';

interface Env {
  t: TestDb;
  app: FastifyInstance;
  clock: ReturnType<typeof manualClock>;
}

const useEnv = (iso = '2026-10-08T09:10:00+07:00'): Env => {
  const env = {} as Env;
  beforeAll(async () => {
    env.t = await createTestDb();
    await seedReference(env.t.db);
    env.clock = manualClock(iso);
    env.app = await buildTestApp({ db: env.t.db, clock: env.clock });
    await env.app.ready();
  });
  afterAll(async () => {
    await env.app.close();
    await env.t.cleanup();
  });
  return env;
};

let seq = 0;
const newVehicle = async (env: Env, model = 'Crossover LX') => {
  seq += 1;
  const id = `VEH-Q${String(seq).padStart(4, '0')}`;
  await env.t.db.insert(vehicles).values({
    id,
    customerId: 'CUS-10482',
    modelYear: 2022,
    modelName: model,
    powertrain: 'ICE',
    vin: `QVIN${String(seq).padStart(13, '0')}`,
    plate: null,
  });
  return id;
};

const bookReq = (vehicleId: string, o: Record<string, unknown> = {}) => ({
  customerId: 'CUS-10482',
  vehicleId,
  dealershipId: 'DLR-01',
  serviceTypeCode: 'BRAKE_PAD_REPLACEMENT',
  date: '2026-10-09',
  startTime: '10:00',
  bookingSessionId: randomUUID(),
  ...o,
});

const book = async (env: Env, o: Record<string, unknown> = {}, vehicleId?: string) => {
  const res = await env.app.inject({ method: 'POST', url: paths.appointments, payload: bookReq(vehicleId ?? (await newVehicle(env)), o) });
  expect(res.statusCode, res.body).toBe(201);
  return AppointmentDetail.parse(res.json());
};

const resched = (env: Env, reference: string, o: { date: string; startTime: string; bookingSessionId?: string }) =>
  env.app.inject({ method: 'POST', url: paths.rescheduleAppointment(reference), payload: { bookingSessionId: randomUUID(), ...o } });

const cancel = (env: Env, reference: string) =>
  env.app.inject({ method: 'POST', url: paths.cancelAppointment(reference), payload: {} });

const code = (res: { json: () => unknown }) => Problem.parse(res.json()).code;

const rowOf = async (env: Env, reference: string) =>
  (await env.t.db.select().from(appointments).where(eq(appointments.reference, reference)))[0]!;

const stock = async (env: Env, sku: string, dealershipId = 'DLR-01') =>
  (await env.t.db.select().from(inventory).where(and(eq(inventory.dealershipId, dealershipId), eq(inventory.sku, sku))))[0]!;

const partLines = async (env: Env, reference: string) =>
  env.t.db.select().from(appointmentParts).where(eq(appointmentParts.appointmentId, (await rowOf(env, reference)).id));

const seedAppt = async (
  env: Env,
  o: { tech: string; bay: string; date: string; from: string; to: string; dealership?: string; vehicleId?: string },
) => {
  const vehicleId = o.vehicleId ?? (await newVehicle(env));
  seq += 1;
  const startAt = new Date(`${o.date}T${o.from}:00+07:00`);
  const endAt = new Date(`${o.date}T${o.to}:00+07:00`);
  await env.t.db.insert(appointments).values({
    reference: `APT-${o.date.replaceAll('-', '')}-7${String(seq).padStart(3, '0')}`,
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
  });
};

const grid = async (env: Env, q: { dealership?: string; service: string; date: string; vehicleId: string; exclude?: string }) => {
  const url = `${paths.availability(q.dealership ?? 'DLR-01')}?serviceType=${q.service}&date=${q.date}&vehicleId=${q.vehicleId}${q.exclude ? `&excludeReference=${q.exclude}` : ''}`;
  return env.app.inject({ method: 'GET', url });
};

/** A raw pooled connection holding an open transaction, to force a chosen interleaving of two real requests. */
const hold = async (env: Env, lockSql: string, params: unknown[] = []) => {
  const c = await env.t.db.$client.connect();
  await c.query('BEGIN');
  await c.query(lockSql, params);
  let done = false;
  const end = async (sql: string) => {
    if (done) return;
    done = true;
    try {
      await c.query(sql);
    } finally {
      c.release();
    }
  };
  return { query: (sql: string, params?: unknown[]) => c.query(sql, params), commit: () => end('COMMIT'), rollback: () => end('ROLLBACK') };
};

/** Poll until `n` backends of this database are waiting on a lock (a real, observed interleaving, not a sleep). */
const waitBlocked = async (env: Env, n: number) => {
  for (let i = 0; i < 100; i++) {
    const r = await env.t.db.$client.query(
      "select count(*)::int as c from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
    );
    if ((r.rows[0] as { c: number }).c >= n) return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`fewer than ${n} backends became lock-blocked`);
};

const APPT_LOCK = 'SELECT 1 FROM appointments WHERE reference = $1 FOR UPDATE';

// ---------------------------------------------------------------------------------------------------------------
describe('review: validation parity with booking (§6.5 step 1 = §6.1 step 1)', () => {
  const env = useEnv();

  // Every target below is invalid for both endpoints; reschedule must answer with exactly booking's status and code.
  const cases: Array<[label: string, service: string, date: string, time: string]> = [
    ['Saturday', 'OIL_CHANGE', '2026-10-10', '10:00'],
    ['yesterday', 'OIL_CHANGE', '2026-10-07', '10:00'],
    ['horizon+1 working day', 'OIL_CHANGE', '2026-11-09', '10:00'],
    ['last horizon day is a Saturday', 'OIL_CHANGE', '2026-11-07', '10:00'],
    ['before opening', 'OIL_CHANGE', '2026-10-12', '07:30'],
    ['ends after closing (45 min at 16:30)', 'OIL_CHANGE', '2026-10-12', '16:30'],
    ['starts at closing', 'OIL_CHANGE', '2026-10-12', '17:00'],
    ['off the 30-minute grid', 'OIL_CHANGE', '2026-10-12', '10:15'],
    ['off the grid by 5 minutes', 'OIL_CHANGE', '2026-10-12', '10:05'],
    ['same-day, non-express service', 'BRAKE_PAD_REPLACEMENT', TODAY, '14:00'],
    ['same-day, before the lead time', 'OIL_CHANGE', TODAY, '11:00'],
    ['same-day, in the past', 'OIL_CHANGE', TODAY, '08:00'],
    ['same-day, past cutoff by duration', 'OIL_CHANGE', TODAY, '16:30'],
    ['brake ends after closing', 'BRAKE_PAD_REPLACEMENT', '2026-10-12', '16:00'],
  ];

  it('P1 every 422 of booking is the same status and code on reschedule (14 targets); the row is untouched and no events are written', async () => {
    const oil = await book(env, { serviceTypeCode: 'OIL_CHANGE', date: '2026-10-09' });
    const brake = await book(env, { serviceTypeCode: 'BRAKE_PAD_REPLACEMENT', date: '2026-10-09', startTime: '13:00' });
    const eventsBefore = (await env.t.db.select().from(bookingEvents)).length;
    for (const [label, service, date, time] of cases) {
      const target = service === 'OIL_CHANGE' ? oil : brake;
      const booking = await env.app.inject({
        method: 'POST',
        url: paths.appointments,
        payload: bookReq(await newVehicle(env), { serviceTypeCode: service, date, startTime: time }),
      });
      const res = await resched(env, target.reference, { date, startTime: time });
      expect([label, res.statusCode, code(res)], label).toEqual([label, booking.statusCode, code(booking)]);
      expect(res.statusCode, label).toBe(422);
    }
    // booking calls above wrote no events either (validation errors never do); reschedule must match that.
    expect((await env.t.db.select().from(bookingEvents)).length).toBe(eventsBefore);
    expect((await rowOf(env, oil.reference)).startAt).toEqual(new Date('2026-10-09T10:00:00+07:00'));
  });

  it('P2 malformed bodies are 400 VALIDATION_ERROR, exactly like booking (bad date, impossible date, bad time, missing session)', async () => {
    const a = await book(env, { date: '2026-10-13' });
    const bad = [
      { date: '2026-11-31', startTime: '10:00' },
      { date: '2026-10-14', startTime: '9:00' },
      { date: '2026-10-14', startTime: '25:00' },
      { date: '2026-10-14', startTime: '10:00:00' },
      { date: '14/10/2026', startTime: '10:00' },
    ];
    for (const b of bad) {
      const res = await env.app.inject({ method: 'POST', url: paths.rescheduleAppointment(a.reference), payload: { bookingSessionId: randomUUID(), ...b } });
      expect([b, res.statusCode]).toEqual([b, 400]);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
    const noSession = await env.app.inject({ method: 'POST', url: paths.rescheduleAppointment(a.reference), payload: { date: '2026-10-14', startTime: '10:00' } });
    expect(noSession.statusCode).toBe(400);
    const notUuid = await env.app.inject({ method: 'POST', url: paths.rescheduleAppointment(a.reference), payload: { date: '2026-10-14', startTime: '10:00', bookingSessionId: 'x' } });
    expect(notUuid.statusCode).toBe(400);
    expect((await rowOf(env, a.reference)).startAt).toEqual(new Date('2026-10-13T10:00:00+07:00'));
  });

  it('P3 non-reschedulable wins over an invalid target, and a no-op target on a CANCELLED appointment is still 409 (not a silent 200)', async () => {
    const a = await book(env, { date: '2026-10-15', startTime: '10:00' });
    expect((await cancel(env, a.reference)).statusCode).toBe(200);
    const same = await resched(env, a.reference, { date: '2026-10-15', startTime: '10:00' });
    expect(same.statusCode).toBe(409);
    expect(code(same)).toBe('APPOINTMENT_NOT_RESCHEDULABLE');
    const invalid = await resched(env, a.reference, { date: '2026-10-17', startTime: '10:00' });
    expect(invalid.statusCode).toBe(409);
    expect(code(invalid)).toBe('APPOINTMENT_NOT_RESCHEDULABLE');
  });

  it('P4 the vehicle’s appointment at ANOTHER dealership blocks the target too (409 VEHICLE_ALREADY_BOOKED), row unchanged', async () => {
    const vehicleId = await newVehicle(env);
    const a = await book(env, { date: '2026-10-16', startTime: '08:00' }, vehicleId);
    await seedAppt(env, { dealership: 'DLR-02', tech: 'TEC-05', bay: 'BAY-06', date: '2026-10-19', from: '09:00', to: '11:00', vehicleId });
    const before = await rowOf(env, a.reference);
    const res = await resched(env, a.reference, { date: '2026-10-19', startTime: '10:00' });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('VEHICLE_ALREADY_BOOKED');
    expect(await rowOf(env, a.reference)).toEqual(before);
    // back-to-back with the other dealership's job (it ends 11:00) is fine
    expect((await resched(env, a.reference, { date: '2026-10-19', startTime: '11:00' })).statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('review: same-day lead time is evaluated against the injected clock at request time', () => {
  const env = useEnv();

  it('L1 a started minute rounds up (09:30:30 → earliest 12:00): 11:30 is LEAD_TIME_NOT_MET like booking, 12:00 is accepted', async () => {
    env.clock.set('2026-10-08T09:30:30+07:00');
    const a = await book(env, { serviceTypeCode: 'OIL_CHANGE', date: '2026-10-09' });
    const early = await resched(env, a.reference, { date: TODAY, startTime: '11:30' });
    expect(early.statusCode).toBe(422);
    expect(code(early)).toBe('LEAD_TIME_NOT_MET');
    const ok = await resched(env, a.reference, { date: TODAY, startTime: '12:00' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(AppointmentDetail.parse(ok.json()).channel).toBe('SAME_DAY');
    expect((await cancel(env, a.reference)).statusCode).toBe(200); // frees the single same-day quota share for L2
  });

  it('L2 the same target is rejected at 09:50 and accepted at 09:10 (the clock is read per request, not cached)', async () => {
    env.clock.set('2026-10-08T09:10:00+07:00');
    const a = await book(env, { serviceTypeCode: 'OIL_CHANGE', date: '2026-10-12' });
    env.clock.set('2026-10-08T09:50:00+07:00'); // earliest = 11:50 → 12:00
    expect(code(await resched(env, a.reference, { date: TODAY, startTime: '11:30' }))).toBe('LEAD_TIME_NOT_MET');
    env.clock.set('2026-10-08T09:10:00+07:00');
    expect((await resched(env, a.reference, { date: TODAY, startTime: '11:30' })).statusCode).toBe(200);
  });

  it('L3 late in the day the whole day is closed to same-day (PAST_CUTOFF surfaces as 422 LEAD_TIME_NOT_MET, as in booking)', async () => {
    env.clock.set('2026-10-08T15:20:00+07:00');
    const a = await book(env, { serviceTypeCode: 'OIL_CHANGE', date: '2026-10-13' });
    const res = await resched(env, a.reference, { date: TODAY, startTime: '16:00' });
    expect(res.statusCode).toBe(422);
    expect(code(res)).toBe('LEAD_TIME_NOT_MET');
    // moving to a later day is unaffected by the cutoff
    expect((await resched(env, a.reference, { date: '2026-10-14', startTime: '16:00' })).statusCode).toBe(200);
  });

  it('L4 an appointment whose start equals "now" exactly is not reschedulable (start_at <= now); one second earlier it is', async () => {
    env.clock.set('2026-10-08T09:10:00+07:00');
    const a = await book(env, { serviceTypeCode: 'BRAKE_PAD_REPLACEMENT', date: '2026-10-09', startTime: '10:00' });
    env.clock.set('2026-10-09T10:00:00+07:00');
    const res = await resched(env, a.reference, { date: '2026-10-12', startTime: '10:00' });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('APPOINTMENT_NOT_RESCHEDULABLE');
    env.clock.set('2026-10-09T09:59:59+07:00');
    const ok = await resched(env, a.reference, { date: '2026-10-12', startTime: '10:00' });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  // SPEC §6.5: "Target equals the current date + startTime → 200, nothing changes, no event". Implementation validates the
  // target first (booking's lead-time / express rules for "today"), so an ADVANCE appointment that has become "today"
  // answers the no-op with 422 instead of 200. Low severity; the SPEC order of operations is ambiguous, Opus decides.
  it('Q2-D3 no-op target on an ADVANCE appointment whose day is now "today" → 200 unchanged, not 422 SERVICE_NOT_EXPRESS (SPEC §6.5 idempotency)', async () => {
    env.clock.set('2026-10-08T09:10:00+07:00');
    const a = await book(env, { serviceTypeCode: 'BRAKE_PAD_REPLACEMENT', date: '2026-10-20', startTime: '10:00' });
    env.clock.set('2026-10-20T08:00:00+07:00');
    const eventsBefore = (await env.t.db.select().from(bookingEvents)).length;
    const res = await resched(env, a.reference, { date: '2026-10-20', startTime: '10:00' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await env.t.db.select().from(bookingEvents)).length).toBe(eventsBefore);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('review: parts and channel consistency after failures and across transitions', () => {
  const env = useEnv();
  const SKUS = ['OIL-5W30-4L', 'FLT-OIL-CX22'];
  const reservedNow = async () => Promise.all(SKUS.map(async (s) => (await stock(env, s)).reserved));

  it('C1 ADVANCE → today into a quota-reached window: 409 SAME_DAY_QUOTA_REACHED, nothing reserved, no appointment_parts, row unchanged', async () => {
    await book(env, { serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '13:00' }); // uses the only same-day quota share
    const reservedBefore = await reservedNow();
    const a = await book(env, { serviceTypeCode: 'OIL_CHANGE', date: '2026-10-09' });
    const before = await rowOf(env, a.reference);
    const res = await resched(env, a.reference, { date: TODAY, startTime: '13:00' });
    expect(res.statusCode).toBe(409);
    const problem = Problem.parse(res.json());
    expect(problem.code).toBe('SLOT_UNAVAILABLE');
    expect(problem.reason).toBe('SAME_DAY_QUOTA_REACHED');
    expect(await rowOf(env, a.reference)).toEqual(before);
    expect(await reservedNow()).toEqual(reservedBefore);
    expect(await partLines(env, a.reference)).toHaveLength(0);
  });

  it('C2 ADVANCE → today when the vehicle clashes with its own other job: VEHICLE_ALREADY_BOOKED, nothing reserved', async () => {
    const vehicleId = await newVehicle(env);
    const a = await book(env, { serviceTypeCode: 'OIL_CHANGE', date: '2026-10-09' }, vehicleId);
    await seedAppt(env, { tech: 'TEC-02', bay: 'BAY-05', date: TODAY, from: '15:00', to: '16:00', vehicleId });
    const reservedBefore = await reservedNow();
    const res = await resched(env, a.reference, { date: TODAY, startTime: '15:30' });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('VEHICLE_ALREADY_BOOKED');
    expect(await reservedNow()).toEqual(reservedBefore);
    expect(await partLines(env, a.reference)).toHaveLength(0);
  });

  it('C3 SAME_DAY → ADVANCE → SAME_DAY → cancel: reserved returns to baseline exactly once; parts lines end released', async () => {
    const base = await reservedNow();
    const a = await book(env, { serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '12:00' });
    expect(await reservedNow()).toEqual(base.map((n) => n + 1));
    expect((await resched(env, a.reference, { date: '2026-10-12', startTime: '10:00' })).statusCode).toBe(200);
    expect(await reservedNow()).toEqual(base);
    expect((await resched(env, a.reference, { date: TODAY, startTime: '14:00' })).statusCode).toBe(200);
    expect(await reservedNow()).toEqual(base.map((n) => n + 1));
    expect((await cancel(env, a.reference)).statusCode).toBe(200);
    expect((await cancel(env, a.reference)).statusCode).toBe(200); // idempotent: must not release twice
    expect(await reservedNow()).toEqual(base);
    const lines = await partLines(env, a.reference);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.releasedAt !== null)).toBe(true);
  });

  it('C4 SAME_DAY → SAME_DAY into a taken window: 409, the existing reservation is kept (not released, not doubled)', async () => {
    const a = await book(env, { serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '15:00' });
    const base = await reservedNow();
    // 13:00 is held by the quota-using job from C1 → quota reached for 12:30-13:30
    const res = await resched(env, a.reference, { date: TODAY, startTime: '13:00' });
    expect(res.statusCode).toBe(409);
    expect(await reservedNow()).toEqual(base);
    const lines = await partLines(env, a.reference);
    expect(lines.every((l) => l.releasedAt === null)).toBe(true);
    expect((await rowOf(env, a.reference)).channel).toBe('SAME_DAY');
  });

  // The partial-reservation path (first line reserved, second line loses) cannot be hit with static data because the
  // availability pre-check fails first. It is reachable when stock is drained between the check and the UPDATE
  // (DMS sync). Force that interleaving with a real row lock, once per line, so both orders of the two lines are covered.
  for (const lockedSku of ['OIL-5W30-4L', 'FLT-OIL-CX22']) {
    it(`C5 stock drained by a concurrent DMS update on ${lockedSku} while reserving: full rollback — other line not left reserved, no parts rows, row unchanged, CHECK_FAILED PARTS_UNAVAILABLE`, async () => {
      const a = await book(env, { serviceTypeCode: 'OIL_CHANGE', date: '2026-10-13' });
      const before = await rowOf(env, a.reference);
      const base = await reservedNow();
      const session = randomUUID();
      const h = await hold(env, 'SELECT 1 FROM inventory WHERE dealership_id = $1 AND sku = $2 FOR UPDATE', ['DLR-01', lockedSku]);
      const pending = resched(env, a.reference, { date: TODAY, startTime: '16:00', bookingSessionId: session });
      await waitBlocked(env, 1);
      await h.query('UPDATE inventory SET on_hand = reserved WHERE dealership_id = $1 AND sku = $2', ['DLR-01', lockedSku]);
      await h.commit();
      try {
        const res = await pending;
        expect(res.statusCode, res.body).toBe(409);
        expect(code(res)).toBe('PARTS_UNAVAILABLE');
        expect(await rowOf(env, a.reference)).toEqual(before);
        expect(await reservedNow()).toEqual(base);
        expect(await partLines(env, a.reference)).toHaveLength(0);
        const ev = await env.t.db.select().from(bookingEvents).where(eq(bookingEvents.sessionId, session)).orderBy(asc(bookingEvents.id));
        expect(ev.map((e) => e.type)).toEqual(['SLOT_REQUESTED', 'CHECK_FAILED']);
        expect(ev[1]!.detail).toMatchObject({ reason: 'PARTS_UNAVAILABLE', alternativeCount: 0 });
      } finally {
        await env.t.db.update(inventory).set({ onHand: 10 }).where(and(eq(inventory.dealershipId, 'DLR-01'), eq(inventory.sku, lockedSku)));
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
describe('review: golden check — the availability grid (excludeReference) and reschedule agree on every slot', () => {
  const env = useEnv();

  const parity = async (opts: { service: string; date: string; vehicleId: string; reference: string }) => {
    const res = await grid(env, { service: opts.service, date: opts.date, vehicleId: opts.vehicleId, exclude: opts.reference });
    expect(res.statusCode, res.body).toBe(200);
    const g = AvailabilityResponse.parse(res.json());
    expect(g.slots.length).toBeGreaterThan(0);
    const bad = g.slots.filter((s) => s.status !== 'AVAILABLE');
    const good = g.slots.filter((s) => s.status === 'AVAILABLE');
    expect(good.length).toBeGreaterThan(0);
    for (const s of bad) {
      const r = await resched(env, opts.reference, { date: opts.date, startTime: s.startTime });
      expect([s.startTime, r.statusCode, r.statusCode === 409 ? Problem.parse(r.json()).reason : undefined]).toEqual([s.startTime, 409, s.status]);
    }
    for (const s of good) {
      const r = await resched(env, opts.reference, { date: opts.date, startTime: s.startTime });
      expect([s.startTime, r.statusCode, r.body.slice(0, 120)].slice(0, 2)).toEqual([s.startTime, 200]);
      // the proposed resources of the grid are what the engine then assigns (grid is computed excluding the appointment)
      const d = AppointmentDetail.parse(r.json());
      expect(d.technician.id).toBe(s.proposed!.technician.id);
      expect(d.serviceBay.id).toBe(s.proposed!.serviceBay.id);
    }
    return { good: good.length, bad: bad.length };
  };

  it('G1 advance brake onto a loaded future day: every AVAILABLE slot → 200 with the proposed resources, every other slot → 409 with the same reason', async () => {
    const vehicleId = await newVehicle(env);
    const a = await book(env, { date: '2026-10-09', startTime: '08:00' }, vehicleId);
    await seedAppt(env, { tech: 'TEC-01', bay: 'BAY-03', date: '2026-10-12', from: '08:00', to: '17:00' });
    await seedAppt(env, { tech: 'TEC-03', bay: 'BAY-01', date: '2026-10-12', from: '09:00', to: '11:00' });
    await seedAppt(env, { tech: 'TEC-02', bay: 'BAY-02', date: '2026-10-12', from: '13:00', to: '15:00' });
    await seedAppt(env, { tech: 'TEC-04', bay: 'BAY-04', date: '2026-10-12', from: '14:00', to: '16:00' });
    const r = await parity({ service: 'BRAKE_PAD_REPLACEMENT', date: '2026-10-12', vehicleId, reference: a.reference });
    expect(r.bad).toBeGreaterThan(0);
  });

  it('G2 the appointment’s own current window is AVAILABLE in its own grid (its resources are excluded)', async () => {
    const vehicleId = await newVehicle(env);
    const a = await book(env, { date: '2026-10-14', startTime: '10:00' }, vehicleId);
    await seedAppt(env, { tech: 'TEC-01', bay: 'BAY-03', date: '2026-10-14', from: '08:00', to: '17:00' });
    const g = AvailabilityResponse.parse((await grid(env, { service: 'BRAKE_PAD_REPLACEMENT', date: '2026-10-14', vehicleId, exclude: a.reference })).json());
    for (const t of ['09:00', '09:30', '10:00', '10:30', '11:00']) expect(g.slots.find((s) => s.startTime === t)!.status, t).toBe('AVAILABLE');
    const without = AvailabilityResponse.parse((await grid(env, { service: 'BRAKE_PAD_REPLACEMENT', date: '2026-10-14', vehicleId })).json());
    expect(without.slots.find((s) => s.startTime === '10:00')!.status).not.toBe('AVAILABLE');
  });

  it('G3 ADVANCE oil change → today (quota cap 1 used by another job, parts checked): grid and reschedule agree on every slot', async () => {
    await book(env, { serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '13:00' });
    const vehicleId = await newVehicle(env);
    const a = await book(env, { serviceTypeCode: 'OIL_CHANGE', date: '2026-10-09' }, vehicleId);
    const r = await parity({ service: 'OIL_CHANGE', date: TODAY, vehicleId, reference: a.reference });
    expect(r.bad).toBeGreaterThan(0); // the quota window around 13:00 must have been rejected, not silently accepted
    expect((await rowOf(env, a.reference)).channel).toBe('SAME_DAY');
  });

  it('G4 SAME_DAY oil change moving within today with the stock exactly consumed by itself: grid is not blocked, every AVAILABLE slot → 200', async () => {
    const vehicleId = await newVehicle(env);
    const a = await book(env, { dealershipId: 'DLR-03', serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime: '12:00' }, vehicleId);
    for (const sku of ['OIL-5W30-4L', 'FLT-OIL-CX22']) {
      const s = await stock(env, sku, 'DLR-03');
      await env.t.db.update(inventory).set({ onHand: s.reserved }).where(and(eq(inventory.dealershipId, 'DLR-03'), eq(inventory.sku, sku)));
    }
    const g = AvailabilityResponse.parse(
      (await grid(env, { dealership: 'DLR-03', service: 'OIL_CHANGE', date: TODAY, vehicleId, exclude: a.reference })).json(),
    );
    expect(g.sameDay?.blocked).toBeNull();
    const plain = AvailabilityResponse.parse((await grid(env, { dealership: 'DLR-03', service: 'OIL_CHANGE', date: TODAY, vehicleId })).json());
    expect(plain.sameDay?.blocked).toBe('PARTS_UNAVAILABLE'); // without the exclusion the same grid is blocked
    for (const s of g.slots.filter((x) => x.status === 'AVAILABLE')) {
      const r = await env.app.inject({
        method: 'POST',
        url: paths.rescheduleAppointment(a.reference),
        payload: { date: TODAY, startTime: s.startTime, bookingSessionId: randomUUID() },
      });
      expect([s.startTime, r.statusCode]).toEqual([s.startTime, 200]);
    }
  });

  it('G5 excludeReference scope: other dealership / service / vehicle → 422 RESCHEDULE_SCOPE_MISMATCH; unknown → 404; malformed → 400', async () => {
    const vehicleId = await newVehicle(env);
    const a = await book(env, { date: '2026-10-15' }, vehicleId);
    const other = await newVehicle(env);
    const base = { date: '2026-10-16', vehicleId, service: 'BRAKE_PAD_REPLACEMENT', exclude: a.reference };
    const dealership = await grid(env, { ...base, dealership: 'DLR-02' });
    const service = await grid(env, { ...base, service: 'WHEEL_ALIGNMENT' });
    const vehicle = await grid(env, { ...base, vehicleId: other });
    for (const res of [dealership, service, vehicle]) {
      expect(res.statusCode, res.body).toBe(422);
      expect(code(res)).toBe('RESCHEDULE_SCOPE_MISMATCH');
    }
    expect((await grid(env, { ...base, exclude: 'APT-20261009-0000' })).statusCode).toBe(404);
    expect((await grid(env, { ...base, exclude: 'nonsense' })).statusCode).toBe(400);
  });

  it('G6 a CANCELLED reference: the grid is just the plain grid (nothing to exclude) — documents that it does not warn the client', async () => {
    const vehicleId = await newVehicle(env);
    const a = await book(env, { date: '2026-10-21' }, vehicleId);
    expect((await cancel(env, a.reference)).statusCode).toBe(200);
    const withRef = await grid(env, { date: '2026-10-22', vehicleId, service: 'BRAKE_PAD_REPLACEMENT', exclude: a.reference });
    const plain = await grid(env, { date: '2026-10-22', vehicleId, service: 'BRAKE_PAD_REPLACEMENT' });
    expect(withRef.statusCode).toBe(200);
    expect(withRef.json()).toEqual(plain.json());
    // ...and the matching reschedule is refused, so the screen must rely on the 409 (R9), not on the grid
    expect(code(await resched(env, a.reference, { date: '2026-10-22', startTime: '10:00' }))).toBe('APPOINTMENT_NOT_RESCHEDULABLE');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('review: history and audit events', () => {
  const env = useEnv();

  it('H1 history summaries: cross-day "Rescheduled from Fri 9 Oct 10:00 to Mon 12 Oct 13:00 — <bay>, <tech>", same-day without dates', async () => {
    const a = await book(env, { date: '2026-10-09', startTime: '10:00' });
    const cross = AppointmentDetail.parse((await resched(env, a.reference, { date: '2026-10-12', startTime: '13:00' })).json());
    const last = cross.history.at(-1)!;
    expect(last.type).toBe('APPOINTMENT_RESCHEDULED');
    expect(last.summary).toBe(`Rescheduled from Fri 9 Oct 10:00 to Mon 12 Oct 13:00 — ${cross.serviceBay.name}, ${cross.technician.name}`);
    const same = AppointmentDetail.parse((await resched(env, a.reference, { date: '2026-10-12', startTime: '15:00' })).json());
    expect(same.history.at(-1)!.summary).toBe(`Rescheduled from 13:00 to 15:00 — ${same.serviceBay.name}, ${same.technician.name}`);
    expect(same.history.filter((h) => h.type === 'APPOINTMENT_RESCHEDULED')).toHaveLength(2);
    // the from/to detail chains: the 2nd event's "from" is the 1st event's "to"
    const [e1, e2] = same.history.filter((h) => h.type === 'APPOINTMENT_RESCHEDULED').map((h) => h.detail as { from: unknown; to: unknown });
    expect(e2!.from).toEqual(e1!.to);
  });

  it('H2 a failed attempt that REUSES the booking session id leaves the appointment’s history untouched (no stray "Customer chose" lines)', async () => {
    const a = await book(env, { date: '2026-10-16', startTime: '10:00' });
    await seedAppt(env, { tech: 'TEC-01', bay: 'BAY-03', date: '2026-10-19', from: '08:00', to: '17:00' });
    await seedAppt(env, { tech: 'TEC-03', bay: 'BAY-02', date: '2026-10-19', from: '08:00', to: '17:00' });
    const sessionOfBooking = (await rowOf(env, a.reference)).bookingSessionId!;
    const before = AppointmentDetail.parse((await env.app.inject({ method: 'GET', url: paths.appointment(a.reference) })).json());
    const res = await resched(env, a.reference, { date: '2026-10-19', startTime: '10:00', bookingSessionId: sessionOfBooking });
    expect(res.statusCode).toBe(409);
    const after = AppointmentDetail.parse((await env.app.inject({ method: 'GET', url: paths.appointment(a.reference) })).json());
    expect(after.history).toEqual(before.history);
    expect(after.history.some((h) => h.type === 'CHECK_FAILED')).toBe(false);
  });

  it('H3 a refused attempt writes exactly SLOT_REQUESTED(rescheduleOf) + CHECK_FAILED under its own session, none attached to the appointment; success adds one APPOINTMENT_RESCHEDULED and no CHECK_PASSED / APPOINTMENT_CREATED', async () => {
    const a = await book(env, { date: '2026-10-20', startTime: '10:00' });
    await seedAppt(env, { tech: 'TEC-01', bay: 'BAY-03', date: '2026-10-21', from: '08:00', to: '17:00' });
    await seedAppt(env, { tech: 'TEC-03', bay: 'BAY-02', date: '2026-10-21', from: '08:00', to: '17:00' });
    const id = (await rowOf(env, a.reference)).id;
    const ownBefore = (await env.t.db.select().from(bookingEvents).where(eq(bookingEvents.appointmentId, id))).length;
    const session = randomUUID();
    expect((await resched(env, a.reference, { date: '2026-10-21', startTime: '10:00', bookingSessionId: session })).statusCode).toBe(409);
    const ev = await env.t.db.select().from(bookingEvents).where(eq(bookingEvents.sessionId, session)).orderBy(asc(bookingEvents.id));
    expect(ev.map((e) => e.type)).toEqual(['SLOT_REQUESTED', 'CHECK_FAILED']);
    expect(ev.every((e) => e.appointmentId === null)).toBe(true);
    expect(ev[0]!.detail).toMatchObject({ rescheduleOf: a.reference, date: '2026-10-21', startTime: '10:00' });
    expect((await env.t.db.select().from(bookingEvents).where(eq(bookingEvents.appointmentId, id))).length).toBe(ownBefore);
    expect((await resched(env, a.reference, { date: '2026-10-22', startTime: '10:00' })).statusCode).toBe(200);
    const own = await env.t.db.select().from(bookingEvents).where(eq(bookingEvents.appointmentId, id));
    expect(own.length).toBe(ownBefore + 1);
    expect(own.filter((e) => e.type === 'APPOINTMENT_CREATED')).toHaveLength(1);
    expect(own.filter((e) => e.type === 'CHECK_PASSED')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('review: metrics carry bounded, PII-free labels', () => {
  const env = useEnv();

  it('M1 reschedule_attempts_total has only {outcome,reason}; outcome ∈ 4 values; reason is a code or "none"; nothing from the request leaks', async () => {
    const a = await book(env, { date: '2026-10-09', startTime: '10:00' });
    await resched(env, a.reference, { date: '2026-10-12', startTime: '10:00' }); // rescheduled
    await resched(env, a.reference, { date: '2026-10-12', startTime: '10:00' }); // unchanged
    await resched(env, a.reference, { date: '2026-10-17', startTime: '10:00' }); // invalid (422)
    await seedAppt(env, { tech: 'TEC-01', bay: 'BAY-03', date: '2026-10-13', from: '08:00', to: '17:00' });
    await seedAppt(env, { tech: 'TEC-03', bay: 'BAY-02', date: '2026-10-13', from: '08:00', to: '17:00' });
    await resched(env, a.reference, { date: '2026-10-13', startTime: '10:00' }); // rejected (409)
    await resched(env, 'APT-20261009-0000', { date: '2026-10-13', startTime: '10:00' }); // invalid (404)
    await cancel(env, a.reference);
    await resched(env, a.reference, { date: '2026-10-14', startTime: '10:00' }); // rejected (409 not reschedulable)
    const text = (await env.app.inject({ method: 'GET', url: '/metrics' })).body;
    const lines = text.split('\n').filter((l) => l.startsWith('reschedule_attempts_total{'));
    expect(lines.length).toBeGreaterThanOrEqual(5);
    const seen = new Set<string>();
    for (const l of lines) {
      const m = /^reschedule_attempts_total\{([^}]*)\} /.exec(l)!;
      const labels = Object.fromEntries([...m[1]!.matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1]!, x[2]!]));
      expect(Object.keys(labels).sort()).toEqual(['outcome', 'reason']);
      expect(['rescheduled', 'unchanged', 'rejected', 'invalid']).toContain(labels.outcome);
      expect(labels.reason).toMatch(/^(none|[A-Z][A-Z_]+)$/);
      seen.add(`${labels.outcome}/${labels.reason}`);
    }
    for (const want of [
      'rescheduled/none',
      'unchanged/none',
      'invalid/OUTSIDE_BOOKING_HORIZON',
      'invalid/DEALERSHIP_CLOSED',
      'invalid/NOT_FOUND',
      'rejected/APPOINTMENT_NOT_RESCHEDULABLE',
    ]) {
      if (want === 'invalid/OUTSIDE_BOOKING_HORIZON') continue; // 2026-10-17 is a Saturday → DEALERSHIP_CLOSED
      expect([...seen], want).toContain(want);
    }
    expect(text).not.toMatch(/APT-\d{8}-\d{4}/);
    expect(text).not.toMatch(/CUS-\d+|Linh|@example\.com|VEH-/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('review: real races, forced into a specific interleaving with a row lock held from outside', () => {
  const env = useEnv();

  // quota cap 1: same-day windows in this describe must not overlap while both are CONFIRMED
  const sameDayOil = async (startTime: string) => {
    const a = await book(env, { serviceTypeCode: 'OIL_CHANGE', date: TODAY, startTime });
    expect(a.channel).toBe('SAME_DAY');
    return a;
  };
  const reserved = async () => Promise.all(['OIL-5W30-4L', 'FLT-OIL-CX22'].map(async (s) => (await stock(env, s)).reserved));

  it('X1 reschedule ∥ check-in (SAME_DAY → ADVANCE, check-in commits first): reschedule 409 and its parts release is rolled back', async () => {
    const a = await sameDayOil('12:00');
    const base = await reserved();
    const h = await hold(env, APPT_LOCK, [a.reference]);
    const checkIn = env.app.inject({ method: 'POST', url: paths.checkIn(a.reference), payload: {} });
    await waitBlocked(env, 1);
    const rs = resched(env, a.reference, { date: '2026-10-09', startTime: '10:00' });
    await waitBlocked(env, 2);
    await h.rollback();
    const [ci, r] = await Promise.all([checkIn, rs]);
    expect(ci.statusCode, ci.body).toBe(200);
    expect(r.statusCode, r.body).toBe(409);
    expect(code(r)).toBe('APPOINTMENT_NOT_RESCHEDULABLE');
    const row = await rowOf(env, a.reference);
    expect(row.checkedInAt).not.toBeNull();
    expect(row.channel).toBe('SAME_DAY');
    expect(row.startAt).toEqual(new Date(`${TODAY}T12:00:00+07:00`));
    expect(await reserved()).toEqual(base); // still held: the checked-in car is in the workshop today
    expect((await partLines(env, a.reference)).every((l) => l.releasedAt === null)).toBe(true);
  });

  it('X2 reschedule ∥ no-show sweeper (sweeper commits first, SAME_DAY → SAME_DAY): status NO_SHOW, parts released exactly once, reschedule 409', async () => {
    const a = await sameDayOil('13:00');
    const base = await reserved();
    const h = await hold(env, APPT_LOCK, [a.reference]);
    const sweep = releaseLateSameDay(env.t.db, fixedClock('2026-10-08T13:16:00+07:00'));
    await waitBlocked(env, 1);
    const rs = resched(env, a.reference, { date: TODAY, startTime: '14:30' });
    await waitBlocked(env, 2);
    await h.rollback();
    const [swept, r] = await Promise.all([sweep, rs]);
    expect(swept.released).toContain(a.reference);
    expect(r.statusCode, r.body).toBe(409);
    expect(code(r)).toBe('APPOINTMENT_NOT_RESCHEDULABLE');
    const row = await rowOf(env, a.reference);
    expect(row.status).toBe('NO_SHOW');
    expect(row.startAt).toEqual(new Date(`${TODAY}T13:00:00+07:00`));
    expect(await reserved()).toEqual(base.map((n) => n - 1));
    expect((await partLines(env, a.reference)).every((l) => l.releasedAt !== null)).toBe(true);
  });

  it('X3 a moved SAME_DAY appointment is judged by its NEW start: the sweeper leaves it alone past the old start + grace, and releases it after the new one', async () => {
    const a = await sameDayOil('14:00');
    expect((await resched(env, a.reference, { date: TODAY, startTime: '15:00' })).statusCode).toBe(200);
    expect((await releaseLateSameDay(env.t.db, fixedClock('2026-10-08T14:16:00+07:00'))).released).not.toContain(a.reference);
    expect((await rowOf(env, a.reference)).status).toBe('CONFIRMED');
    const base = await reserved();
    expect((await releaseLateSameDay(env.t.db, fixedClock('2026-10-08T15:16:00+07:00'))).released).toContain(a.reference);
    expect(await reserved()).toEqual(base.map((n) => n - 1));
  });

  // ---- confirmed defect --------------------------------------------------------------------------------------
  // Lock-order inversion. cancel / markLateNoShow take the APPOINTMENT row first (guarded UPDATE) and then the
  // INVENTORY rows (releaseParts). reschedule SAME_DAY → ADVANCE calls releaseParts (INVENTORY rows) BEFORE its guarded
  // UPDATE of the APPOINTMENT row. Two requests on the same appointment therefore wait on each other: Postgres aborts
  // one with 40P01 and the API answers 500. ADR-006 says reschedule "matches how cancel, check-in and the no-show
  // sweeper already race safely" — true for ADVANCE and SAME_DAY → SAME_DAY, false for SAME_DAY → ADVANCE.
  // Fix direction (not applied): run the guarded UPDATE before releaseParts, or `SELECT … FOR UPDATE` the appointment
  // first, so the order is always appointment → inventory.
  it('Q2-D1 SAME_DAY → ADVANCE reschedule ∥ cancel of the same appointment → cancel 200 + reschedule 409, no 40P01 deadlock (SPEC §6.5)', async () => {
    const a = await sameDayOil('16:00');
    const h = await hold(env, APPT_LOCK, [a.reference]); // cancel queues first on the appointment row...
    const cancelP = cancel(env, a.reference);
    await waitBlocked(env, 1);
    const rs = resched(env, a.reference, { date: '2026-10-09', startTime: '10:00' }); // ...reschedule frees stock first, then queues
    await waitBlocked(env, 2);
    await h.rollback();
    const [c, r] = await Promise.all([cancelP, rs]);
    expect([c.statusCode, r.statusCode], `cancel=${c.body} reschedule=${r.body}`).not.toContain(500);
    // the contract: cancel 200, reschedule 409 (cancel committed first)
    expect(c.statusCode).toBe(200);
    expect(r.statusCode).toBe(409);
  });

  it('Q2-D2 SAME_DAY → ADVANCE reschedule ∥ no-show sweeper on the same appointment → sweeper wins, reschedule 409, no 40P01 deadlock', async () => {
    const a = await sameDayOil('13:30');
    const h = await hold(env, APPT_LOCK, [a.reference]);
    const sweep = releaseLateSameDay(env.t.db, fixedClock('2026-10-08T13:46:00+07:00')).then(
      (v) => ({ ok: true as const, v }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    await waitBlocked(env, 1);
    const rs = resched(env, a.reference, { date: '2026-10-09', startTime: '11:00' });
    await waitBlocked(env, 2);
    await h.rollback();
    const [s, r] = await Promise.all([sweep, rs]);
    expect(s.ok, `sweeper failed: ${s.ok ? '' : String(s.e)}`).toBe(true);
    expect(r.statusCode, r.body).toBe(409);
  });
});
