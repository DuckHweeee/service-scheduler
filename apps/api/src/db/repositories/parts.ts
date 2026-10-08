import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../client.js';
import { inventory, parts, servicePartRequirements } from '../schema.js';

export interface PartsAvailability {
  available: boolean;
  lines: { sku: string; name: string; qty: number }[];
}

/**
 * Parts needed for a service on a vehicle model, and whether the dealership can cover them.
 * Model-specific requirement rows REPLACE the NULL-model rows (SPEC §7). No requirements → available, no lines.
 * Available iff `on_hand - reserved >= qty` for every line (a missing inventory row counts as 0).
 */
export const partsAvailability = async (
  db: DbOrTx,
  dealershipId: string,
  serviceTypeCode: string,
  vehicleModel: string,
): Promise<PartsAvailability> => {
  const select = () =>
    db
      .select({ sku: servicePartRequirements.sku, name: parts.name, qty: servicePartRequirements.qty })
      .from(servicePartRequirements)
      .innerJoin(parts, eq(parts.sku, servicePartRequirements.sku));

  let lines = await select()
    .where(
      and(
        eq(servicePartRequirements.serviceTypeCode, serviceTypeCode),
        eq(servicePartRequirements.vehicleModel, vehicleModel),
      ),
    )
    .orderBy(asc(servicePartRequirements.sku));
  if (lines.length === 0) {
    lines = await select()
      .where(and(eq(servicePartRequirements.serviceTypeCode, serviceTypeCode), isNull(servicePartRequirements.vehicleModel)))
      .orderBy(asc(servicePartRequirements.sku));
  }
  if (lines.length === 0) return { available: true, lines: [] };

  const stock = await db.select().from(inventory).where(eq(inventory.dealershipId, dealershipId));
  const free = new Map(stock.map((s) => [s.sku, s.onHand - s.reserved]));
  const available = lines.every((l) => (free.get(l.sku) ?? 0) >= l.qty);
  return { available, lines };
};
