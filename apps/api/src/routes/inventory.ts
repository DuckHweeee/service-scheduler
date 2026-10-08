// A3: inventory routes (SPEC §6) — stand-in for DMS sync.
import {
  IdParams,
  InventoryItem,
  InventoryItemParams,
  InventoryList,
  UpdateInventoryRequest,
  routes,
} from '@scheduler/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { listInventory, setOnHand } from '../services/inventory.js';

export default async function inventoryRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.get(routes.inventory, { schema: { params: IdParams, response: { 200: InventoryList } } }, async (req) =>
    listInventory(app.db, req.params.id),
  );
  app.put(
    routes.inventoryItem,
    { schema: { params: InventoryItemParams, body: UpdateInventoryRequest, response: { 200: InventoryItem } } },
    async (req) => setOnHand(app.db, req.params.id, req.params.sku, req.body.onHand),
  );
}
