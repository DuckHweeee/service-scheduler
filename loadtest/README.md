# Load test

Proves the booking invariants hold under concurrent load and measures latency. Numbers: [`docs/performance.md`](../docs/performance.md).

| File | Purpose |
|---|---|
| `seed-load.ts` | N customers `LT-CUS-0001...`, each with one ICE vehicle `LT-VEH-0001...` (idempotent) |
| `booking.js` | k6 script: `browse` (constant arrival rate on availability) + `contend` (book the first AVAILABLE slot) |
| `verify-invariants.sql` | One row per violation (overlaps per technician/bay/vehicle, `reserved > on_hand`, same-day parts not reserved). Must return **0 rows** |

## Run

```bash
docker compose --profile app --profile obs up -d --build      # stack + Prometheus/Grafana (:3001)
pnpm loadtest:seed                                            # LT_CUSTOMERS=200 by default
pnpm loadtest:run                                             # k6 in the grafana/k6 image, ~2 min
docker compose exec -T postgres psql -U postgres -d scheduler -v ON_ERROR_STOP=1 < loadtest/verify-invariants.sql
```

`pnpm loadtest:run` starts `grafana/k6` with `--add-host=host.docker.internal:host-gateway` and targets
`http://host.docker.internal:3000` (override with `BASE_URL`). Other knobs (env): `DURATION` (60s), `BROWSE_RATE` (20 req/s),
`CONTEND_VUS` (20), `LT_CUSTOMERS` (200), `DAYS` (3; working days competing for capacity, max ~20 inside the 30-day horizon).
Thresholds: no 5xx/network errors (`http_req_failed` rate 0, 4xx are expected business outcomes), no unexpected status, availability
p95 < 400 ms, booking p95 < 800 ms.

The load run only creates advance bookings. Capacity is finite (about 36 oil-change-sized jobs per dealership-day), so with
`DAYS=20` it fills up part-way through; that is when 409 `SLOT_UNAVAILABLE` and "no slot" iterations dominate.

## Re-running from a clean state

The load fills the calendar. Reset with `docker compose --profile app run --rm -e SEED=always migrate`, then `pnpm loadtest:seed`
again (the reseed truncates customers), and restart the API to zero its counters (`docker compose restart api`).

## Notes

- Measure with tracing **off** (`OTEL_EXPORTER_OTLP_ENDPOINT` unset). At 100% sampling and ~700 req/s Jaeger all-in-one (in-memory)
  exhausts memory within seconds; the compose file caps it (`mem_limit: 1g`, `MEMORY_MAX_TRACES`) so it is killed alone instead of
  stalling the Docker VM.
- Without the Docker `app` profile: run the API on the host (`pnpm dev`), `pnpm loadtest:seed` against the embedded Postgres, then
  `pnpm loadtest:run`, and run the SQL with `psql "$DATABASE_URL" -f loadtest/verify-invariants.sql`.
