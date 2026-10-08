// Opus-owned shared helper: release an appointment's reserved parts (cancellation, check-in late release, no-show sweeper).
// Must run inside the caller's transaction, after the status transition that guards against double release.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { appointmentParts, inventory } from '../db/schema.js';

/** Returns the number of part lines released (0 when nothing was reserved or already released). */
export async function releaseParts(
  tx: Tx,
  appt: { id: string; dealershipId: string },
  now: Date,
): Promise<number> {
  const lines = await tx
    .select()
    .from(appointmentParts)
    .where(and(eq(appointmentParts.appointmentId, appt.id), isNull(appointmentParts.releasedAt)));
  // Fixed lock order (by sku) avoids deadlocks between concurrent releases.
  for (const line of lines.sort((a, b) => a.sku.localeCompare(b.sku))) {
    await tx
      .update(inventory)
      .set({ reserved: sql`${inventory.reserved} - ${line.qty}`, updatedAt: now })
      .where(and(eq(inventory.dealershipId, appt.dealershipId), eq(inventory.sku, line.sku)));
    await tx
      .update(appointmentParts)
      .set({ releasedAt: now })
      .where(and(eq(appointmentParts.appointmentId, appt.id), eq(appointmentParts.sku, line.sku)));
  }
  return lines.length;
}
