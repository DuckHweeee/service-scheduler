import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Customer, DealershipList, Problem, ServiceTypeList, VehicleList, paths } from '@scheduler/contracts';
import { fixedClock } from '../../src/clock.js';
import { buildTestApp, createTestDb, seedReference, type TestDb } from '../helpers/index.js';

let t: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  t = await createTestDb();
  await seedReference(t.db);
  app = await buildTestApp({ db: t.db, clock: fixedClock('2026-10-08T09:10:00+07:00') });
});
afterAll(async () => {
  await app.close();
  await t.cleanup();
});

describe('reference routes', () => {
  it('GET /dealerships lists the three seeded dealerships with bay count and policy', async () => {
    const res = await app.inject({ method: 'GET', url: paths.dealerships });
    expect(res.statusCode).toBe(200);
    const body = DealershipList.parse(res.json());
    expect(body.items.map((d) => d.id)).toEqual(['DLR-01', 'DLR-02', 'DLR-03']);
    expect(body.items[0]).toMatchObject({
      timezone: 'Asia/Ho_Chi_Minh',
      opensAt: '08:00',
      closesAt: '17:00',
      workingDays: [1, 2, 3, 4, 5],
      bayCount: 5,
      sameDayPolicy: { leadTimeMin: 120, quotaPct: 20, lateGraceMin: 15 },
    });
  });

  it('GET /service-types lists the eight services', async () => {
    const res = await app.inject({ method: 'GET', url: paths.serviceTypes });
    expect(res.statusCode).toBe(200);
    const body = ServiceTypeList.parse(res.json());
    expect(body.items).toHaveLength(8);
    expect(body.items.find((s) => s.code === 'OIL_CHANGE')).toMatchObject({ isExpress: true, powertrains: ['ICE'] });
  });

  it('GET /customers/:id and /vehicles', async () => {
    const c = await app.inject({ method: 'GET', url: paths.customer('CUS-10482') });
    expect(c.statusCode).toBe(200);
    expect(Customer.parse(c.json())).toMatchObject({ fullName: 'Linh Tran' });

    const v = await app.inject({ method: 'GET', url: paths.customerVehicles('CUS-10482') });
    expect(v.statusCode).toBe(200);
    const body = VehicleList.parse(v.json());
    expect(body.items.map((x) => x.id)).toEqual(['VEH-01', 'VEH-02']);
    expect(body.items[0]).toMatchObject({ vinLast4: '4821', powertrain: 'ICE' });
    expect(JSON.stringify(body)).not.toContain('KL1CX22LXNB104821');
  });

  it('unknown customer → 404 on both routes', async () => {
    for (const url of [paths.customer('CUS-NOPE'), paths.customerVehicles('CUS-NOPE')]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(Problem.parse(res.json()).code).toBe('NOT_FOUND');
    }
  });
});
