// A3: inventory read + simulated DMS sync (SPEC §6).
import type { InventoryItem, InventoryList } from '@scheduler/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { getDealership } from '../db/repositories/index.js';
import { inventory, parts } from '../db/schema.js';
import { DomainError, notFound } from '../domain/errors.js';
import { toOffsetIso } from '../domain/time.js';

const columns = {
  sku: inventory.sku,
  name: parts.name,
  onHand: inventory.onHand,
  reserved: inventory.reserved,
  updatedAt: inventory.updatedAt,
};

const toItem = (r: { sku: string; name: string; onHand: number; reserved: number; updatedAt: Date }, tz: string): InventoryItem => ({
  sku: r.sku,
  name: r.name,
  onHand: r.onHand,
  reserved: r.reserved,
  available: r.onHand - r.reserved,
  updatedAt: toOffsetIso(r.updatedAt, tz),
});

async function requireDealership(db: DbOrTx, id: string) {
  const d = await getDealership(db, id);
  if (!d) throw notFound('Dealership', id);
  return d;
}

export async function listInventory(db: DbOrTx, dealershipId: string): Promise<InventoryList> {
  const d = await requireDealership(db, dealershipId);
  const rows = await db
    .select(columns)
    .from(inventory)
    .innerJoin(parts, eq(parts.sku, inventory.sku))
    .where(eq(inventory.dealershipId, dealershipId))
    .orderBy(asc(inventory.sku));
  return { items: rows.map((r) => toItem(r, d.timezone)) };
}

/** Sets `on_hand`. Unknown dealership/sku → 404; `onHand < reserved` → 409 STOCK_BELOW_RESERVED. */
export async function setOnHand(db: DbOrTx, dealershipId: string, sku: string, onHand: number): Promise<InventoryItem> {
  const d = await requireDealership(db, dealershipId);
  const where = and(eq(inventory.dealershipId, dealershipId), eq(inventory.sku, sku));
  // One guarded statement: no race with a concurrent reservation raising `reserved`.
  const updated = await db
    .update(inventory)
    .set({ onHand, updatedAt: sql`now()` })
    .where(and(where, sql`${inventory.reserved} <= ${onHand}`))
    .returning({ sku: inventory.sku });
  if (updated.length === 0) {
    const [row] = await db.select({ reserved: inventory.reserved }).from(inventory).where(where);
    if (!row) throw notFound('Inventory item', sku);
    throw new DomainError(
      'STOCK_BELOW_RESERVED',
      409,
      `Cannot set on-hand of ${sku} to ${onHand}: ${row.reserved} units are reserved`,
    );
  }
  const [r] = await db.select(columns).from(inventory).innerJoin(parts, eq(parts.sku, inventory.sku)).where(where);
  return toItem(r!, d.timezone);
}
