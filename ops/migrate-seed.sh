#!/bin/sh
# One-shot used by the compose `migrate` service: always migrate; seed only an empty database, so restarting the stack
# does not wipe bookings. Force a reseed with:  docker compose --profile app run --rm -e SEED=always migrate
set -eu
cd /app/apps/api
pnpm db:migrate
count=$(node --input-type=module -e "
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query('select count(*)::int as n from dealerships');
console.log(r.rows[0].n);
await c.end();
")
if [ "${SEED:-}" = "always" ] || [ "$count" = "0" ]; then
  pnpm db:seed
else
  echo "database already seeded ($count dealerships); skipping seed"
fi
