import type { InventoryItem, InventoryList } from '@scheduler/contracts';
import { UpdateInventoryRequest, routes } from '@scheduler/contracts';
import { HttpResponse, http } from 'msw';
import { apiUrl } from '../../config.js';
import { toOffsetIso } from '../../lib/time.js';
import { PARTS, getDealership, store } from '../store.js';
import type { MockStockLine } from '../store.js';
import { notFound, problem } from '../support.js';

const toItem = (sku: string, name: string, line: MockStockLine, tz: string): InventoryItem => ({
  sku,
  name,
  onHand: line.onHand,
  reserved: line.reserved,
  available: line.onHand - line.reserved,
  updatedAt: toOffsetIso(line.updatedAtMs, tz),
});

export const inventoryHandlers = [
  http.get(apiUrl(routes.inventory), ({ params }) => {
    const d = getDealership(String(params.id));
    if (!d) return notFound('Dealership');
    const stock = store.inventory[d.id]!;
    const items = PARTS.flatMap((p) =>
      stock[p.sku] ? [toItem(p.sku, p.name, stock[p.sku]!, d.timezone)] : [],
    );
    return HttpResponse.json({ items } satisfies InventoryList);
  }),

  http.put(apiUrl(routes.inventoryItem), async ({ params, request }) => {
    const d = getDealership(String(params.id));
    if (!d) return notFound('Dealership');
    const part = PARTS.find((p) => p.sku === params.sku);
    const line = store.inventory[d.id]?.[String(params.sku)];
    if (!part || !line) return notFound('Part');
    const parsed = UpdateInventoryRequest.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
      return problem(400, 'VALIDATION_ERROR', 'onHand must be a non-negative integer.', {
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (parsed.data.onHand < line.reserved) {
      return problem(
        409,
        'STOCK_BELOW_RESERVED',
        `On-hand stock cannot drop below the ${line.reserved} units already reserved.`,
      );
    }
    line.onHand = parsed.data.onHand;
    line.updatedAtMs = Date.now();
    return HttpResponse.json(toItem(part.sku, part.name, line, d.timezone));
  }),
];
