import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { pgErrorCode } from '../../src/plugins/error-handler.js';
import { appointments, inventory } from '../../src/db/schema.js';
import { createTestDb, seedReference, type TestDb } from '../helpers/index.js';

let t: TestDb;
let n = 0;

beforeAll(async () => {
  t = await createTestDb();
  await seedReference(t.db);
});
afterAll(() => t.cleanup());

// All times on 2026-10-09, Asia/Ho_Chi_Minh (UTC+7): `at('10:00')` → 03:00Z.
const at = (hhmm: string) => new Date(`2026-10-09T${hhmm}:00+07:00`);

const book = (o: {
  start: string;
  end: string;
  tech?: string;
  bay?: string;
  vehicle?: string;
  dealership?: string;
  status?: 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW';
}) => {
  n += 1;
  const start = at(o.start);
  const end = at(o.end);
  return t.db.insert(appointments).values({
    reference: `APT-20261009-${String(n).padStart(4, '0')}`,
    status: o.status ?? 'CONFIRMED',
    channel: 'ADVANCE',
    customerId: 'CUS-10482',
    vehicleId: o.vehicle ?? 'VEH-01',
    dealershipId: o.dealership ?? 'DLR-01',
    serviceTypeCode: 'GENERAL_INSPECTION',
    technicianId: o.tech ?? 'TEC-01',
    serviceBayId: o.bay ?? 'BAY-01',
    startAt: start,
    endAt: end,
    durationMin: (end.getTime() - start.getTime()) / 60_000,
  });
};

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected the statement to fail');
};

describe('appointments exclusion constraints', () => {
  it('rejects overlapping CONFIRMED appointments for the same technician (23P01)', async () => {
    await book({ start: '10:00', end: '12:00', tech: 'TEC-01', bay: 'BAY-01', vehicle: 'VEH-01' });
    const err = await failure(book({ start: '11:00', end: '12:30', tech: 'TEC-01', bay: 'BAY-02', vehicle: 'VEH-02' }));
    expect(pgErrorCode(err)).toBe('23P01');
    expect(JSON.stringify((err as { cause?: unknown }).cause ?? err, Object.getOwnPropertyNames(err as object))).toContain(
      'no_technician_overlap',
    );
  });

  it('rejects overlapping CONFIRMED appointments for the same bay (23P01)', async () => {
    const err = await failure(book({ start: '11:00', end: '12:30', tech: 'TEC-03', bay: 'BAY-01', vehicle: 'VEH-02' }));
    expect(pgErrorCode(err)).toBe('23P01');
  });

  it('rejects overlapping CONFIRMED appointments for the same vehicle (23P01)', async () => {
    const err = await failure(book({ start: '11:00', end: '12:30', tech: 'TEC-03', bay: 'BAY-02', vehicle: 'VEH-01' }));
    expect(pgErrorCode(err)).toBe('23P01');
  });

  it('allows overlaps with CANCELLED and NO_SHOW rows, and back-to-back bookings', async () => {
    await book({ start: '10:00', end: '12:00', status: 'CANCELLED' }); // same resources as the first row
    await book({ start: '10:30', end: '11:30', status: 'NO_SHOW' });
    await book({ start: '12:00', end: '13:00' }); // back-to-back with [10:00,12:00)
    const rows = await t.db.select().from(appointments).where(eq(appointments.technicianId, 'TEC-01'));
    expect(rows.filter((r) => r.status === 'CONFIRMED')).toHaveLength(2);
  });

  it('a cancelled row cannot block a later CONFIRMED one but a new confirmed overlap is still rejected', async () => {
    const err = await failure(book({ start: '12:30', end: '13:30' }));
    expect(pgErrorCode(err)).toBe('23P01');
  });
});

describe('composite foreign keys', () => {
  it('rejects a DLR-02 technician on a DLR-01 appointment (23503)', async () => {
    const err = await failure(book({ start: '14:00', end: '15:00', tech: 'TEC-05', bay: 'BAY-03', vehicle: 'VEH-02' }));
    expect(pgErrorCode(err)).toBe('23503');
  });

  it('rejects a DLR-02 bay on a DLR-01 appointment (23503)', async () => {
    const err = await failure(book({ start: '14:00', end: '15:00', tech: 'TEC-02', bay: 'BAY-06', vehicle: 'VEH-02' }));
    expect(pgErrorCode(err)).toBe('23503');
  });

  it('accepts a matching DLR-02 appointment', async () => {
    await book({ start: '14:00', end: '15:00', tech: 'TEC-05', bay: 'BAY-06', vehicle: 'VEH-02', dealership: 'DLR-02' });
  });
});

describe('generated range & checks', () => {
  it('rejects end_at <= start_at (23514)', async () => {
    const err = await failure(book({ start: '15:00', end: '15:00', vehicle: 'VEH-02' }));
    expect(pgErrorCode(err)).toBe('23514');
  });

  it('rejects inventory.reserved > on_hand (23514)', async () => {
    const err = await failure(
      t.db.update(inventory).set({ reserved: 11 }).where(eq(inventory.sku, 'OIL-5W30-4L')),
    );
    expect(pgErrorCode(err)).toBe('23514');
  });

  it('formats references from appointment_ref_seq', async () => {
    const res = await t.db.execute<{ n: string }>(
      (await import('drizzle-orm')).sql`select nextval('appointment_ref_seq') as n`,
    );
    expect(Number(res.rows[0]!.n)).toBeGreaterThan(0);
  });
});
