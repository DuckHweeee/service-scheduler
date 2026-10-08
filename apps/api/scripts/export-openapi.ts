// Exports the OpenAPI document to docs/openapi.yaml. No database connection: `db` is only decorated, never queried.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Problem } from '@scheduler/contracts';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { fixedClock } from '../src/clock.js';
import type { Db } from '../src/db/client.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../../docs/openapi.yaml');

const DESCRIPTION = [
  'Service-appointment booking API. A time is confirmed only when a service bay and a qualified technician are both free',
  'for the whole job. Double-booking is prevented twice: bookings for a dealership-day are serialised with a Postgres',
  'advisory lock and re-checked inside the transaction, and an exclusion constraint on bay and technician time ranges',
  '(confirmed appointments only) rejects any overlap that slips through, returning 409 SLOT_UNAVAILABLE with alternatives.',
  'Same-day booking is restricted to express services, needs a minimum lead time, is capped by a daily quota, and',
  'reserves parts atomically (409 PARTS_UNAVAILABLE when stock is short); a same-day customer who arrives later than the',
  'grace period is marked NO_SHOW and their resources are released. All errors are RFC 7807 application/problem+json.',
].join(' ');

const TAGS = [
  { name: 'Reference', description: 'Dealerships, service types, customers and vehicles.' },
  { name: 'Availability', description: 'Slot grid for one day, including same-day policy.' },
  { name: 'Appointments', description: 'Book, list, view, cancel and check in.' },
  { name: 'Operations', description: 'Day board and inventory (stand-in for DMS sync).' },
  { name: 'Health', description: 'Liveness and readiness probes.' },
];

function tagFor(path: string): string {
  if (path.startsWith('/health')) return 'Health';
  if (path.includes('/appointments')) return 'Appointments';
  if (path.endsWith('/availability')) return 'Availability';
  if (path.endsWith('/board') || path.includes('/inventory')) return 'Operations';
  return 'Reference';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Json)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
}

const app = await buildApp({ db: {} as Db, clock: fixedClock('2026-01-01T00:00:00Z') });
await app.ready();
const doc = app.swagger() as Json;

doc.info = { title: 'Unified Service Scheduler API', version: '0.1.0', description: DESCRIPTION };
doc.tags = TAGS;
doc.servers = [{ url: 'http://localhost:3000', description: 'Local development' }];

const problemSchema = z.toJSONSchema(Problem, { target: 'draft-2020-12' }) as Json;
delete problemSchema.$schema;
doc.components ??= {};
doc.components.schemas = { ...(doc.components.schemas ?? {}), Problem: problemSchema };

const problemResponse = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
});
const ERR_DESC: Record<string, string> = {
  400: 'Validation error (VALIDATION_ERROR)',
  404: 'Not found (NOT_FOUND)',
  409: 'Business conflict (e.g. SLOT_UNAVAILABLE, PARTS_UNAVAILABLE, VEHICLE_ALREADY_BOOKED, APPOINTMENT_NOT_CANCELLABLE, LATE_ARRIVAL, APPOINTMENT_NOT_ACTIVE, STOCK_BELOW_RESERVED)',
  422: 'Rule violation (e.g. OUTSIDE_BOOKING_HORIZON, SERVICE_NOT_APPLICABLE, DEALERSHIP_CLOSED, OUTSIDE_OPENING_HOURS, MISALIGNED_START, VEHICLE_NOT_OWNED, SERVICE_NOT_EXPRESS, LEAD_TIME_NOT_MET)',
};
// Error statuses per SPEC section 6 (400 for anything with params/body/query).
const SPEC_ERRORS: Record<string, number[]> = {
  'GET /api/v1/customers/{id}': [400, 404],
  'GET /api/v1/customers/{id}/vehicles': [400, 404],
  'GET /api/v1/dealerships/{id}/availability': [400, 404, 422],
  'POST /api/v1/appointments': [400, 404, 409, 422],
  'GET /api/v1/appointments': [400],
  'GET /api/v1/appointments/{reference}': [400, 404],
  'POST /api/v1/appointments/{reference}/cancel': [400, 404, 409],
  'POST /api/v1/appointments/{reference}/check-in': [400, 404, 409],
  'GET /api/v1/dealerships/{id}/board': [400, 404],
  'GET /api/v1/dealerships/{id}/inventory': [400, 404],
  'PUT /api/v1/dealerships/{id}/inventory/{sku}': [400, 404, 409],
};

for (const [path, item] of Object.entries<Json>(doc.paths)) {
  for (const [method, op] of Object.entries<Json>(item)) {
    op.tags = [tagFor(path)];
    op.responses ??= {};
    for (const status of SPEC_ERRORS[`${method.toUpperCase()} ${path}`] ?? []) {
      op.responses[String(status)] = problemResponse(ERR_DESC[String(status)] ?? 'Error');
    }
  }
}

// `yaml` is a dependency of @fastify/swagger (not of this package): resolve it from there.
const swaggerRequire = createRequire(createRequire(import.meta.url).resolve('@fastify/swagger'));
const { stringify } = swaggerRequire('yaml') as { stringify: (v: unknown, o?: object) => string };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, stringify(sortKeys(doc), { lineWidth: 0 }));
await app.close();
console.log(`wrote ${out}`);
