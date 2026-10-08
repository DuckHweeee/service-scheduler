import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AvailabilityResponse, InventoryItem, InventoryList, Problem, paths } from '@scheduler/contracts';
import { and, eq } from 'drizzle-orm';
import { fixedClock } from '../../src/clock.js';
import { inventory } from '../../src/db/schema.js';
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

const put = (dealership: string, sku: string, body: unknown) =>
  app.inject({ method: 'PUT', url: paths.inventoryItem(dealership, sku), payload: body as object });

describe('inventory routes', () => {
  it('GET lists all parts with available = onHand - reserved', async () => {
    const res = await app.inject({ method: 'GET', url: paths.inventory('DLR-02') });
    expect(res.statusCode).toBe(200);
    const body = InventoryList.parse(res.json());
    expect(body.items).toHaveLength(6);
    expect(body.items.find((i) => i.sku === 'FLT-OIL-CX22')).toMatchObject({ onHand: 0, reserved: 0, available: 0 });
    expect(body.items.find((i) => i.sku === 'OIL-5W30-4L')).toMatchObject({ onHand: 10, available: 10 });
  });

  it('unknown dealership / sku → 404', async () => {
    const list = await app.inject({ method: 'GET', url: paths.inventory('DLR-99') });
    expect(list.statusCode).toBe(404);
    const unknownSku = await put('DLR-01', 'NOPE', { onHand: 3 });
    expect(unknownSku.statusCode).toBe(404);
    expect(Problem.parse(unknownSku.json()).code).toBe('NOT_FOUND');
    const unknownDlr = await put('DLR-99', 'OIL-5W30-4L', { onHand: 3 });
    expect(unknownDlr.statusCode).toBe(404);
  });

  it('invalid body → 400 VALIDATION_ERROR', async () => {
    const res = await put('DLR-01', 'OIL-5W30-4L', { onHand: -1 });
    expect(res.statusCode).toBe(400);
    expect(Problem.parse(res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('below reserved → 409 STOCK_BELOW_RESERVED, row unchanged; at reserved is allowed', async () => {
    await t.db
      .update(inventory)
      .set({ reserved: 4 })
      .where(and(eq(inventory.dealershipId, 'DLR-03'), eq(inventory.sku, 'FLT-AIR-GEN')));
    const bad = await put('DLR-03', 'FLT-AIR-GEN', { onHand: 3 });
    expect(bad.statusCode).toBe(409);
    expect(Problem.parse(bad.json()).code).toBe('STOCK_BELOW_RESERVED');
    const [row] = await t.db
      .select()
      .from(inventory)
      .where(and(eq(inventory.dealershipId, 'DLR-03'), eq(inventory.sku, 'FLT-AIR-GEN')));
    expect(row?.onHand).toBe(10);

    const good = await put('DLR-03', 'FLT-AIR-GEN', { onHand: 4 });
    expect(good.statusCode).toBe(200);
    expect(InventoryItem.parse(good.json())).toMatchObject({ onHand: 4, reserved: 4, available: 0 });
  });

  it('setting FLT-OIL-CX22 at DLR-01 to 0 makes the same-day oil change PARTS_UNAVAILABLE', async () => {
    const q = `${paths.availability('DLR-01')}?serviceType=OIL_CHANGE&date=2026-10-08&vehicleId=VEH-01`;
    const before = AvailabilityResponse.parse((await app.inject({ method: 'GET', url: q })).json());
    expect(before.sameDay?.blocked).toBeNull();

    const res = await put('DLR-01', 'FLT-OIL-CX22', { onHand: 0 });
    expect(res.statusCode).toBe(200);
    expect(InventoryItem.parse(res.json())).toMatchObject({ sku: 'FLT-OIL-CX22', onHand: 0, available: 0 });

    const after = AvailabilityResponse.parse((await app.inject({ method: 'GET', url: q })).json());
    expect(after.sameDay?.blocked).toBe('PARTS_UNAVAILABLE');
    expect(after.slots).toEqual([]);
  });
});
