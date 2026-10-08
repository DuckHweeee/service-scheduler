import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { BoardResponse, Problem, paths } from '@scheduler/contracts';
import { fixedClock } from '../../src/clock.js';
import { appointments } from '../../src/db/schema.js';
import { toInstant } from '../../src/domain/time.js';
import { buildTestApp, createTestDb, seedReference, type TestDb } from '../helpers/index.js';

const TZ = 'Asia/Ho_Chi_Minh';
let t: TestDb;
let app: FastifyInstance;

const appt = (
  n: number,
  o: {
    status: 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW';
    date: string;
    startMin: number;
    durMin: number;
    tech: string;
    bay: string;
    service?: string;
    channel?: 'ADVANCE' | 'SAME_DAY';
    dealership?: string;
  },
) => ({
  reference: `APT-${o.date.replaceAll('-', '')}-${String(n).padStart(4, '0')}`,
  status: o.status,
  channel: o.channel ?? ('ADVANCE' as const),
  customerId: 'CUS-10482',
  vehicleId: n % 2 ? 'VEH-01' : 'VEH-02',
  dealershipId: o.dealership ?? 'DLR-01',
  serviceTypeCode: o.service ?? 'GENERAL_INSPECTION',
  technicianId: o.tech,
  serviceBayId: o.bay,
  startAt: toInstant(o.date, o.startMin, TZ),
  endAt: toInstant(o.date, o.startMin + o.durMin, TZ),
  durationMin: o.durMin,
});

beforeAll(async () => {
  t = await createTestDb();
  await seedReference(t.db);
  app = await buildTestApp({ db: t.db, clock: fixedClock('2026-10-08T09:10:00+07:00') });
  const date = '2026-10-09';
  await t.db.insert(appointments).values([
    // inserted out of order on purpose
    appt(3, { status: 'CONFIRMED', date, startMin: 13 * 60, durMin: 30, tech: 'TEC-02', bay: 'BAY-01' }),
    appt(1, { status: 'CONFIRMED', date, startMin: 9 * 60, durMin: 30, tech: 'TEC-02', bay: 'BAY-01' }),
    appt(2, { status: 'NO_SHOW', date, startMin: 11 * 60, durMin: 30, tech: 'TEC-02', bay: 'BAY-01', channel: 'SAME_DAY' }),
    appt(4, { status: 'CANCELLED', date, startMin: 9 * 60, durMin: 30, tech: 'TEC-02', bay: 'BAY-01' }),
    // other date and other dealership must not leak in
    appt(5, { status: 'CONFIRMED', date: '2026-10-12', startMin: 9 * 60, durMin: 30, tech: 'TEC-01', bay: 'BAY-02' }),
    appt(6, { status: 'CONFIRMED', date, startMin: 9 * 60, durMin: 30, tech: 'TEC-05', bay: 'BAY-06', dealership: 'DLR-02' }),
    // a past day (no horizon restriction)
    appt(7, { status: 'CONFIRMED', date: '2026-10-05', startMin: 8 * 60, durMin: 45, tech: 'TEC-01', bay: 'BAY-02', service: 'TIRE_ROTATION' }),
  ]);
});
afterAll(async () => {
  await app.close();
  await t.cleanup();
});

const board = async (dealership: string, date: string) =>
  app.inject({ method: 'GET', url: `${paths.board(dealership)}?date=${date}` });

describe('GET /dealerships/:id/board', () => {
  it('returns all bays and technicians, sorted blocks, CANCELLED excluded, NO_SHOW included', async () => {
    const res = await board('DLR-01', '2026-10-09');
    expect(res.statusCode).toBe(200);
    const body = BoardResponse.parse(res.json());
    expect(body).toMatchObject({
      dealership: { id: 'DLR-01', timezone: TZ },
      date: '2026-10-09',
      isWorkingDay: true,
      opensAt: '08:00',
      closesAt: '17:00',
    });
    expect(body.bays.map((b) => b.id)).toEqual(['BAY-01', 'BAY-02', 'BAY-03', 'BAY-04', 'BAY-05']);
    expect(body.technicians.map((x) => x.id)).toEqual(['TEC-01', 'TEC-02', 'TEC-03', 'TEC-04']);
    expect(body.technicians[0]!.skills).toEqual(['GENERAL', 'BRAKES', 'EV_HIGH_VOLTAGE']);

    const bay1 = body.bays[0]!.blocks;
    expect(bay1.map((b) => [b.startTime, b.status])).toEqual([
      ['09:00', 'CONFIRMED'],
      ['11:00', 'NO_SHOW'],
      ['13:00', 'CONFIRMED'],
    ]);
    expect(bay1[0]).toMatchObject({
      endTime: '09:30',
      startAt: '2026-10-09T09:00:00+07:00',
      serviceTypeCode: 'GENERAL_INSPECTION',
      serviceTypeName: 'General inspection',
      checkedInAt: null,
    });
    expect(bay1[1]!.channel).toBe('SAME_DAY');
    expect(body.technicians[1]!.blocks).toEqual(bay1);
    // idle resources are present with empty blocks
    expect(body.bays[2]!.blocks).toEqual([]);
    expect(body.technicians[3]!.blocks).toEqual([]);
    // DLR-02 booking at the same time is not on DLR-01's board
    expect(JSON.stringify(body)).not.toContain('BAY-06');
  });

  it('past days and weekends are allowed', async () => {
    const past = BoardResponse.parse((await board('DLR-01', '2026-10-05')).json());
    expect(past.bays[1]!.blocks).toHaveLength(1);
    expect(past.bays[1]!.blocks[0]).toMatchObject({ serviceTypeName: 'Tire rotation', endTime: '08:45' });

    const weekend = BoardResponse.parse((await board('DLR-01', '2026-10-10')).json());
    expect(weekend.isWorkingDay).toBe(false);
    expect(weekend.bays).toHaveLength(5);
  });

  it('unknown dealership → 404; malformed date → 400 VALIDATION_ERROR', async () => {
    const nf = await board('DLR-99', '2026-10-09');
    expect(nf.statusCode).toBe(404);
    expect(Problem.parse(nf.json()).code).toBe('NOT_FOUND');

    const bad = await board('DLR-01', 'not-a-date');
    expect(bad.statusCode).toBe(400);
    expect(Problem.parse(bad.json()).code).toBe('VALIDATION_ERROR');
    const missing = await app.inject({ method: 'GET', url: paths.board('DLR-01') });
    expect(missing.statusCode).toBe(400);
  });
});
