import { randomUUID } from 'node:crypto';
import { AppointmentDetail, AppointmentList, paths, Problem, type CreateAppointmentRequest } from '@scheduler/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock.js';
import type { Db } from '../../src/db/client.js';
import { appointments, bookingEvents, customers, vehicles } from '../../src/db/schema.js';
import { buildTestApp, createTestDb, seedReference, type TestDb } from '../helpers/index.js';

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

// ---- end helpers ----


const get = (url: string) => app.inject({ method: 'GET', url });

describe('GET /appointments/{reference}: history', () => {
  it('fail-then-succeed in one booking session matches the design-03 sequence', async () => {
    const date = '2026-10-12';
    await occupy(t.db, { tech: 'TEC-01', bay: 'BAY-03', date, from: '09:00', to: '12:00' });
    await occupy(t.db, { tech: 'TEC-03', bay: 'BAY-04', date, from: '09:00', to: '12:00' });
    const bookingSessionId = randomUUID();

    const failed = await post(app, bookingBody({ date, startTime: '10:00', bookingSessionId }));
    expect(failed.statusCode).toBe(409);
    expect(failed.json().alternatives).toHaveLength(5);

    const ok = await post(app, bookingBody({ date, startTime: '12:00', bookingSessionId }));
    expect(ok.statusCode).toBe(201);

    const res = await get(paths.appointment(ok.json().reference));
    expect(res.statusCode).toBe(200);
    const detail = AppointmentDetail.parse(res.json());
    expect(detail.history.map((h) => h.type)).toEqual([
      'SLOT_REQUESTED',
      'CHECK_FAILED',
      'CHECK_PASSED',
      'RESOURCES_RESERVED',
      'APPOINTMENT_CREATED',
    ]);
    expect(detail.history.map((h) => h.summary)).toEqual([
      'Requested 10:00–12:00',
      'Check failed: no Brakes-qualified technician free for the full window. Five alternatives offered.',
      'Check passed: Bay 1 and Riya Patel free 12:00–14:00',
      'Bay and technician reserved together',
      'Appointment record created · confirmation sent',
    ]);
    expect(detail).toMatchObject({
      customer: { id: 'CUS-10482', fullName: 'Linh Tran' },
      vehicle: { id: 'VEH-01', vinLast4: '4821' },
      dealership: { id: 'DLR-01', timezone: 'Asia/Ho_Chi_Minh' },
      serviceType: { code: 'BRAKE_PAD_REPLACEMENT', requiredSkill: 'BRAKES', isExpress: false },
      technician: { id: 'TEC-03', skills: ['GENERAL', 'BRAKES'] },
      lateGraceMin: 15,
    });
  });

  it('events of OTHER sessions never leak into the history', async () => {
    const [v1, v2] = await addVehicles(t.db, 2);
    const a = await post(app, bookingBody({ vehicleId: v1!, date: '2026-10-13' }));
    const b = await post(app, bookingBody({ vehicleId: v2!, date: '2026-10-13', startTime: '14:00' }));
    const da = (await get(paths.appointment(a.json().reference))).json();
    expect(da.history).toHaveLength(4);
    expect((await get(paths.appointment(b.json().reference))).json().history).toHaveLength(4);
  });

  it('seeded-style appointment (no session): summary without "confirmation sent"', async () => {
    await occupy(t.db, { tech: 'TEC-02', bay: 'BAY-02', date: '2026-10-13', from: '08:00', to: '09:00' });
    const [row] = await t.db.select().from(appointments).where(eq(appointments.technicianId, 'TEC-02'));
    await t.db.insert(bookingEvents).values({ appointmentId: row!.id, type: 'APPOINTMENT_CREATED', detail: { seeded: true } });
    const res = await get(paths.appointment(row!.reference));
    expect(res.json().history.map((h: { summary: string }) => h.summary)).toEqual(['Appointment record created']);
  });

  it('unknown reference → 404; malformed → 400', async () => {
    const nf = await get(paths.appointment('APT-20261012-0000'));
    expect(nf.statusCode).toBe(404);
    expect(Problem.parse(nf.json()).code).toBe('NOT_FOUND');
    expect((await get(paths.appointment('whatever'))).statusCode).toBe(400);
  });
});

describe('GET /appointments?customerId=&status=', () => {
  it('upcoming first (ascending), then past (descending); status filter', async () => {
    // a separate customer so the list is fully controlled
    await t.db.insert(customers).values({ id: 'CUS-LIST', fullName: 'List Tester' });
    const own = async (date: string, startTime: string) => {
      const [vehicleId] = await addVehicles(t.db, 1);
      await t.db.update(vehicles).set({ customerId: 'CUS-LIST' }).where(eq(vehicles.id, vehicleId!));
      const r = await post(app, bookingBody({ customerId: 'CUS-LIST', vehicleId: vehicleId!, date, startTime, serviceTypeCode: 'GENERAL_INSPECTION' }));
      expect(r.statusCode, r.body).toBe(201);
      return r.json().reference as string;
    };
    const late = await own('2026-10-20', '09:00');
    const soon = await own('2026-10-09', '15:00');
    const mid = await own('2026-10-14', '08:30');
    // past ones: insert directly, before "now" (2026-10-08 09:10)
    let seqRef = 0;
    const past = async (date: string, from: string, to: string) => {
      const [vehicleId] = await addVehicles(t.db, 1);
      seqRef += 1;
      await t.db.insert(appointments).values({
        reference: `APT-${date.replaceAll('-', '')}-8${String(seqRef).padStart(3, '0')}`,
        channel: 'ADVANCE',
        customerId: 'CUS-LIST',
        vehicleId: vehicleId!,
        dealershipId: 'DLR-01',
        serviceTypeCode: 'GENERAL_INSPECTION',
        technicianId: 'TEC-02',
        serviceBayId: 'BAY-02',
        startAt: new Date(`${date}T${from}:00+07:00`),
        endAt: new Date(`${date}T${to}:00+07:00`),
        durationMin: 30,
      });
      return `APT-${date.replaceAll('-', '')}-8${String(seqRef).padStart(3, '0')}`;
    };
    const p1 = await past('2026-09-01', '10:00', '10:30');
    const p2 = await past('2026-09-15', '10:00', '10:30');

    const res = await get(`${paths.appointments}?customerId=CUS-LIST`);
    expect(res.statusCode).toBe(200);
    const list = AppointmentList.parse(res.json());
    expect(list.items.map((i) => i.reference)).toEqual([soon, mid, late, p2, p1]);
    expect(list.items[0]).toMatchObject({
      status: 'CONFIRMED',
      dealership: { id: 'DLR-01', name: 'Northside Service Center' },
      serviceType: { code: 'GENERAL_INSPECTION' },
      startTime: '15:00',
    });

    await app.inject({ method: 'POST', url: paths.cancelAppointment(mid) });
    const cancelled = AppointmentList.parse((await get(`${paths.appointments}?customerId=CUS-LIST&status=CANCELLED`)).json());
    expect(cancelled.items.map((i) => i.reference)).toEqual([mid]);
    const confirmed = AppointmentList.parse((await get(`${paths.appointments}?customerId=CUS-LIST&status=CONFIRMED`)).json());
    expect(confirmed.items.map((i) => i.reference)).toEqual([soon, late, p2, p1]);
  });

  it('customerId is required → 400; unknown customer → empty list', async () => {
    expect((await get(paths.appointments)).statusCode).toBe(400);
    expect((await get(`${paths.appointments}?customerId=CUS-NOBODY`)).json()).toEqual({ items: [] });
  });
});
