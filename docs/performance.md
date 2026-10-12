# Performance and load test

Reproduce with the commands in [`loadtest/README.md`](../loadtest/README.md).

## Setup

| | |
|---|---|
| Machine | Apple Mac mini M4 (10 cores, 16 GB), Docker Desktop VM: 10 CPUs, 7.65 GiB. No per-container limits (Jaeger is capped at 1 GiB; it was off for this run). |
| Stack | `docker compose --profile app --profile obs`: Postgres 18, API (`node:22-slim`, tsx, pg pool = 10 connections, one process), Prometheus scraping every 5 s. k6 (`grafana/k6:1.2.1`) in a separate container. Tracing off, `LOG_LEVEL=info`. |
| Dataset | Seed data (3 dealerships, 481 background appointments) + 200 load customers/vehicles. Load targets DLR-01 and DLR-02 (3 general/alignment bays and 4 technicians each that can do oil change, inspection, tire rotation), advance bookings on the next 20 working days. |
| Scenarios | `browse`: 20 req/s constant arrival rate on availability. `contend`: 20 looping VUs, each picks a random load customer, dealership and service, reads availability (scanning days from the first), books the first `AVAILABLE` slot with a fresh `bookingSessionId`, no idempotency key; 409 is an expected outcome. 120 s. |

## Results (one 120 s run, `DAYS=20`)

| | |
|---|---|
| Total throughput | 772 req/s (93,067 requests), 0 failed (no 5xx, no network errors), 0 unexpected statuses |
| Availability `GET` | p50 3.3 ms, p95 13.0 ms, p99 16.4 ms, max 155 ms (server-side `availability_compute` p95 17 ms) |
| Booking `POST` | p50 42.7 ms, p95 100.9 ms, p99 146.8 ms, max 234 ms |
| Booking outcomes | 1,001 created (201), 626 conflicts (409): `NO_BAY` 457, `FULLY_BOOKED` 142, `VEHICLE_ALREADY_BOOKED` 23, `NO_QUALIFIED_TECHNICIAN` 4 |
| Iterations that found no slot | 3,544 of 7,571 (the calendar fills up: ~1,000 new bookings on top of 481 background ones) |
| Reserve transaction (Prometheus) | p50 18 ms, p95 42 ms, p99 50 ms |
| Advisory lock wait (Prometheus) | p50 2.5 ms, p95 22 ms, p99 36 ms |
| Thresholds | pass: `http_req_failed` rate 0, `unexpected_status` 0, availability p95 < 400 ms (13 ms), booking p95 < 800 ms (101 ms) |

Thresholds were set after the first runs with headroom (about 4x to 8x the measured p95), so they catch regressions without flaking on a
busy CI machine. Variance between runs on this machine was small (availability p95 13 to 19 ms, booking p95 100 to 152 ms; the higher
numbers were with tracing on).

### Invariant check after the run

`psql -f loadtest/verify-invariants.sql` (checks overlapping CONFIRMED pairs per technician, per bay and per vehicle with `&&` on
`during`, `reserved > on_hand`, and same-day appointments with unreserved parts):

```
 violation | subject | a | b
-----------+---------+---+---
(0 rows)
```

1,482 CONFIRMED appointments (481 seed + 1,001 created), no other statuses. The script itself was validated against a transaction that
drops the exclusion constraints and inserts an overlapping row: it reported `TECHNICIAN_OVERLAP` and `BAY_OVERLAP` (then rolled back).

### Grafana

![Grafana dashboard after the run](screenshots/grafana.png)

Reschedule panel shows "No data" until the API exposes `reschedule_attempts_total` (W5-A8); the load test does not reschedule.

## What the numbers mean

- **Availability is cheap and scales horizontally**: it is a read-only computation on a day's appointments (p95 13 ms at ~700 req/s with a
  10-connection pool and one Node process). It takes no lock.
- **Bookings serialise per (dealership, day)**. Every booking takes `pg_advisory_xact_lock` on `dealershipId:date`, re-reads the day inside
  the transaction and inserts. Bookings for different days or dealerships run in parallel; two bookings for the same day queue. In this
  run 20 VUs, all starting their scan on the same first days of two dealerships, queue on only a handful of locks: the lock wait p95 is 22 ms
  against a reserve p95 of 42 ms. The lock wait is about half of reserve time, which is what contention looks like: reserve time
  rising together with lock wait means a busy day, not slow queries. Per dealership-day the throughput ceiling is about
  `1 / (reserve time without the wait)`, i.e. tens of bookings per second here; real traffic is spread over days and dealerships.
- **409s are the system working**: concurrent customers saw the same first `AVAILABLE` slot, one won, the others got `SLOT_UNAVAILABLE`
  (`NO_BAY`/`FULLY_BOOKED`/...) with alternatives. Whether the in-lock re-check or the exclusion constraint rejected each one is not
  separated in the metrics (both surface as 409). After ~1,000 bookings, 47% of contend iterations found no slot at all.
- **Not measured**: multiple API instances (the advisory lock is in Postgres, so it holds across instances, but the shared pool and
  database CPU become the limit), same-day booking with parts reservation (the invariant query covers it, the load does not exercise it),
  cancellations and check-ins under load.

## Observed during the work

- With tracing on at ~700 req/s (100% sampling) Jaeger all-in-one was OOM-killed twice, and the first time the Docker VM stalled for about
  a minute (a few requests took 57 s, event-loop lag spiked, then everything recovered the moment Jaeger was killed). It is not an
  API problem, but it is why tracing should stay off (or sampled) for load tests; the compose file now caps Jaeger.
- The API has no OTLP sampler setting; a `OTEL_TRACES_SAMPLER=parentbased_traceidratio` env would fix this if the SDK honours it
  (`apps/api/src/instrumentation.ts` is outside this work package).
