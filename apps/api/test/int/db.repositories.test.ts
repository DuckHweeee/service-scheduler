import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  getCustomer,
  getDealership,
  getServiceType,
  getVehicle,
  listBays,
  listDealerships,
  listServiceTypes,
  listTechnicians,
  listVehiclesByCustomer,
  loadDayContext,
  partsAvailability,
  type DealershipRow,
} from '../../src/db/repositories/index.js';
import { appointments, inventory } from '../../src/db/schema.js';
import { createTestDb, seedReference, type TestDb } from '../helpers/index.js';

let t: TestDb;
let dlr1: DealershipRow;

beforeAll(async () => {
  t = await createTestDb();
  await seedReference(t.db);
  dlr1 = (await getDealership(t.db, 'DLR-01'))!;
});
afterAll(() => t.cleanup());

describe('reference lookups', () => {
  it('returns plain typed rows with HH:mm times', async () => {
    expect(dlr1).toMatchObject({
      id: 'DLR-01',
      name: 'Northside Service Center',
      timezone: 'Asia/Ho_Chi_Minh',
      opensAt: '08:00',
      closesAt: '17:00',
      workingDays: [1, 2, 3, 4, 5],
      sameDayLeadMin: 120,
      sameDayQuotaPct: 20,
      lateGraceMin: 15,
    });
    expect((await listDealerships(t.db)).map((d) => d.id)).toEqual(['DLR-01', 'DLR-02', 'DLR-03']);
    expect(await getDealership(t.db, 'NOPE')).toBeNull();
  });

  it('service types, customers, vehicles, bays, technicians', async () => {
    expect(await listServiceTypes(t.db)).toHaveLength(8);
    expect(await getServiceType(t.db, 'OIL_CHANGE')).toMatchObject({
      durationMin: 45,
      allowedBayTypes: ['GENERAL_LIFT', 'ALIGNMENT_RACK'],
      isExpress: true,
      powertrains: ['ICE'],
    });
    expect(await getCustomer(t.db, 'CUS-10482')).toMatchObject({ fullName: 'Linh Tran' });
    expect((await listVehiclesByCustomer(t.db, 'CUS-10482')).map((v) => v.id)).toEqual(['VEH-01', 'VEH-02']);
    expect(await getVehicle(t.db, 'VEH-01')).toMatchObject({ vin: 'KL1CX22LXNB104821', powertrain: 'ICE' });
    expect((await listBays(t.db, 'DLR-02')).map((b) => b.id)).toEqual(['BAY-06', 'BAY-07', 'BAY-08', 'BAY-09', 'BAY-10']);
    const techs = await listTechnicians(t.db, 'DLR-01');
    expect(techs.map((x) => x.id)).toEqual(['TEC-01', 'TEC-02', 'TEC-03', 'TEC-04']);
    expect(techs[0]!.skills).toEqual(['GENERAL', 'BRAKES', 'EV_HIGH_VOLTAGE']);
    const dlr3 = await listTechnicians(t.db, 'DLR-03');
    expect(dlr3.some((x) => x.skills.includes('ALIGNMENT'))).toBe(false);
  });
});

describe('partsAvailability', () => {
  it('model-specific rows replace the NULL-model rows', async () => {
    const cx = await partsAvailability(t.db, 'DLR-01', 'OIL_CHANGE', 'Crossover LX');
    expect(cx.available).toBe(true);
    expect(cx.lines.map((l) => l.sku).sort()).toEqual(['FLT-OIL-CX22', 'OIL-5W30-4L']);
    const other = await partsAvailability(t.db, 'DLR-01', 'OIL_CHANGE', 'Sedan GT');
    expect(other.lines.map((l) => l.sku).sort()).toEqual(['FLT-OIL-GEN', 'OIL-5W30-4L']);
    const ev = await partsAvailability(t.db, 'DLR-01', 'AIR_FILTER_REPLACEMENT', 'Compact EV');
    expect(ev.lines).toEqual([{ sku: 'FLT-CABIN-EV24', name: 'Cabin filter Compact EV', qty: 1 }]);
  });

  it('services without requirements are available with no lines', async () => {
    expect(await partsAvailability(t.db, 'DLR-01', 'CAR_WASH', 'Crossover LX')).toEqual({ available: true, lines: [] });
  });

  it('DLR-02 + OIL_CHANGE + Crossover LX is unavailable (FLT-OIL-CX22 = 0) but other models are fine', async () => {
    expect((await partsAvailability(t.db, 'DLR-02', 'OIL_CHANGE', 'Crossover LX')).available).toBe(false);
    expect((await partsAvailability(t.db, 'DLR-02', 'OIL_CHANGE', 'Sedan GT')).available).toBe(true);
  });

  it('honours reserved stock', async () => {
    await t.db.update(inventory).set({ reserved: 10 }).where(eq(inventory.sku, 'FLT-AIR-GEN'));
    expect((await partsAvailability(t.db, 'DLR-01', 'AIR_FILTER_REPLACEMENT', 'Sedan GT')).available).toBe(false);
    await t.db.update(inventory).set({ reserved: 0 }).where(eq(inventory.sku, 'FLT-AIR-GEN'));
  });
});

describe('loadDayContext', () => {
  const DAY = '2026-10-09'; // Friday
  const row = (ref: string, o: Partial<typeof appointments.$inferInsert> & { s: string; e: string; date?: string }) => ({
    reference: ref,
    status: 'CONFIRMED' as const,
    channel: 'ADVANCE' as const,
    customerId: 'CUS-10482',
    vehicleId: 'VEH-01',
    dealershipId: 'DLR-01',
    serviceTypeCode: 'GENERAL_INSPECTION',
    technicianId: 'TEC-01',
    serviceBayId: 'BAY-01',
    startAt: new Date(`${o.date ?? DAY}T${o.s}:00+07:00`),
    endAt: new Date(`${o.date ?? DAY}T${o.e}:00+07:00`),
    durationMin: 0,
    ...o,
  });

  it('returns local-minute busy intervals; ignores cancelled/no-show and other dates; sameDayBusy only SAME_DAY', async () => {
    const strip = ({ s: _s, e: _e, date: _d, ...rest }: ReturnType<typeof row>) => rest as typeof appointments.$inferInsert;
    await t.db.insert(appointments).values([
      strip(row('APT-20261009-1001', { s: '09:00', e: '10:30', durationMin: 90, vehicleId: 'VEH-01' })),
      strip(
        row('APT-20261009-1002', {
          s: '13:00', e: '13:45', durationMin: 45, channel: 'SAME_DAY',
          vehicleId: 'VEH-02', technicianId: 'TEC-02', serviceBayId: 'BAY-02',
        }),
      ),
      strip(row('APT-20261009-1003', { s: '09:00', e: '10:00', durationMin: 60, status: 'CANCELLED' })),
      strip(row('APT-20261009-1004', { s: '14:00', e: '15:00', durationMin: 60, status: 'NO_SHOW' })),
      strip(row('APT-20261012-1005', { s: '09:00', e: '10:00', durationMin: 60, date: '2026-10-12' })),
      strip(row('APT-20261009-1006', { s: '11:00', e: '12:00', durationMin: 60, dealershipId: 'DLR-02', technicianId: 'TEC-05', serviceBayId: 'BAY-06', vehicleId: 'VEH-02' })),
    ]);

    const day = await loadDayContext(t.db, dlr1, DAY, { sameDay: { earliestStart: 660, quotaCap: 1 } });
    expect(day).toMatchObject({ opensAt: 480, closesAt: 1020, isWorkingDay: true });
    const bay = (id: string) => day.bays.find((b) => b.id === id)!;
    const tech = (id: string) => day.technicians.find((x) => x.id === id)!;
    expect(bay('BAY-01').busy).toEqual([{ start: 540, end: 630 }]);
    expect(bay('BAY-02').busy).toEqual([{ start: 780, end: 825 }]);
    expect(bay('BAY-03').busy).toEqual([]);
    expect(tech('TEC-01').busy).toEqual([{ start: 540, end: 630 }]);
    expect(tech('TEC-02').busy).toEqual([{ start: 780, end: 825 }]);
    expect(day.sameDay).toEqual({ earliestStart: 660, quotaCap: 1, sameDayBusy: [{ start: 780, end: 825 }] });
    expect(day.bays).toHaveLength(5);
    expect(day.technicians).toHaveLength(4);

    const other = await loadDayContext(t.db, dlr1, '2026-10-12', { sameDay: null });
    expect(other.sameDay).toBeNull();
    expect(other.bays.find((b) => b.id === 'BAY-01')!.busy).toEqual([{ start: 540, end: 600 }]);
  });

  it('flags weekends as non-working days', async () => {
    const sat = await loadDayContext(t.db, dlr1, '2026-10-10', { sameDay: null });
    expect(sat.isWorkingDay).toBe(false);
  });
});
