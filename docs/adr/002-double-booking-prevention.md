# ADR-002 — Double-booking prevention: advisory lock + exclusion constraints

**Status:** accepted (2026-10-08)

**Context.** Two customers can confirm overlapping windows at the same moment. A check-then-insert in application
code is racy; the availability check must cover the *entire* duration of the job.

**Decision.** Two layers:
1. `pg_advisory_xact_lock(hashtext(dealership || ':' || local_date))` serialises bookings for one dealership-day, so the
   in-transaction re-check and resource choice see a stable picture (and the same-day quota / parts checks stay correct).
2. Postgres `EXCLUDE USING gist` constraints on `(technician_id, during)`, `(service_bay_id, during)` and
   `(vehicle_id, during)` for `status = 'CONFIRMED'` rows make overlap impossible at the storage layer. A `23P01` is mapped
   to `409 SLOT_UNAVAILABLE`.

**Alternatives considered.** SERIALIZABLE isolation with retries (more aborts, harder to reason about);
`SELECT … FOR UPDATE` on resource rows (locks too broadly, doesn't cover "any of N bays"); a slot table with one row per
30-minute cell (simple uniqueness, but variable durations and 45-minute jobs make it lossy).

**Consequences.** Lock granularity is one dealership-day, so contention is limited to customers competing for the same
dealer and date — acceptable at dealership scale and horizontally scalable across dealers. The constraint is the
invariant; the lock is an optimisation for correct candidate selection. Integration tests prove both independently.

**Verified by mutation (W2-A4).** With the advisory lock removed, the concurrency tests still never double-book — the
exclusion constraints reject the losers — but two things degrade: losers get a generic 409 without `reason`/alternatives,
and the **same-day quota is no longer enforced by anything except the coincidence that deterministic assignment sends every
racer to the same bay/technician**. The quota is a count across *different* resources, which no exclusion constraint can
express. Decision: keep the lock as the quota's guarantee (it is cheap at dealership-day granularity); a storage-level
alternative would be a per-dealership-day counter row updated with a conditional `UPDATE … WHERE count < cap`, as done for
parts inventory.
