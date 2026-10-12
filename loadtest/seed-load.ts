// Load-test dataset: N customers (LT-CUS-0001...) each with ONE ICE vehicle (LT-VEH-0001...), so contention in the run is
// about bays and technicians, not VEHICLE_ALREADY_BOOKED. Idempotent (ON CONFLICT DO NOTHING).
//
//   pnpm loadtest:seed                      # 200 customers on DATABASE_URL (default: dev Postgres on :54329)
//   LT_CUSTOMERS=500 DATABASE_URL=... pnpm loadtest:seed
import { createDb } from '../apps/api/src/db/client.js';

const n = Number(process.env.LT_CUSTOMERS ?? 200);
if (!Number.isInteger(n) || n < 1 || n > 9999) throw new Error('LT_CUSTOMERS must be an integer in 1..9999');
const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:54329/scheduler';

const pad = (i: number, w: number) => String(i).padStart(w, '0');
const db = createDb(url);
try {
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  await db.$client.query(
    `INSERT INTO customers (id, full_name, phone, email)
     SELECT 'LT-CUS-' || lpad(i::text, 4, '0'), 'Load Customer ' || i, '+84 90 700 ' || lpad(i::text, 4, '0'),
            'load.' || i || '@example.com'
     FROM unnest($1::int[]) AS i
     ON CONFLICT (id) DO NOTHING`,
    [ids],
  );
  await db.$client.query(
    `INSERT INTO vehicles (id, customer_id, model_year, model_name, powertrain, vin, plate)
     SELECT 'LT-VEH-' || lpad(i::text, 4, '0'), 'LT-CUS-' || lpad(i::text, 4, '0'), 2021, 'Hatch S', 'ICE',
            'KLLT' || lpad(i::text, 13, '0'), '51L-' || lpad(i::text, 4, '0')
     FROM unnest($1::int[]) AS i
     ON CONFLICT (id) DO NOTHING`,
    [ids],
  );
  const { rows } = await db.$client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM vehicles WHERE id LIKE 'LT-VEH-%'`,
  );
  console.log(`load dataset ready: ${rows[0]!.n} customers/vehicles (LT-CUS-${pad(1, 4)}..LT-CUS-${pad(n, 4)})`);
} finally {
  await db.$client.end();
}
