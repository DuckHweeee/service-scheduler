# Brief W2-A4 — Booking command (the critical path)

You are a Sonnet agent implementing **one work package**. Read `CLAUDE.md`, `docs/SPEC.md` (§2, §5.4, §6.1, §6.2, §6.4),
`docs/adr/002-double-booking-prevention.md`, and the shared building blocks listed below. Run `pnpm install` first.

## Goal
`POST /appointments` implementing SPEC §6.1 **exactly**, plus list, detail and cancel. This is the part reviewers will
probe hardest: correctness under concurrency, the full-duration check, and the audit trail.

## Building blocks you consume (read-only)
- `src/services/day-plan.ts` (Opus, read-only, tested in `test/int/day-plan.test.ts`):
  - `resolveDayPlan(db | tx, clock, { dealershipId, serviceTypeCode, vehicleId, date }) → DayPlan` — 404s,
    `SERVICE_NOT_APPLICABLE`, `OUTSIDE_BOOKING_HORIZON`; returns `dealership`, `service`, `vehicle`, `spec`, `today`,
    `isWorkingDay`, `isSameDay`, `sameDay` (policy decision incl. `blocked`), `parts`, and the engine `day` (DayContext,
    with `day.sameDay` set iff same-day and not blocked). A non-working day is not an error here.
  - `loadAlternatives(db, clock, plan, afterStartMin, limit = 5) → AlternativeSlot[]` — re-reads each day; call it
    outside/after the booking transaction.
  - DTO mappers: `toSlotDto(plan, slot)`, `toAlternativeDto(tz, datedSlot)`, `toSameDayInfo(plan)`, `localIso(date, min, tz)`,
    `toServiceSpec(row)`, `BOOKING_HORIZON_DAYS`.
  - Inside the booking transaction, after taking the advisory lock, call `resolveDayPlan(tx, …)` again to get a fresh
    `DayContext` (and fresh parts/quota) under the lock.
- `src/domain/availability` (A2): `checkWindow`, `findAlternatives`.
- `src/db/repositories/**`, `src/domain/time.ts`, `test/helpers/**` (A1) — read their header comments.
- `src/domain/errors.ts` `DomainError`.

## You own
- `apps/api/src/routes/appointments.ts`
- `apps/api/src/services/{booking,cancellation,appointment-query,history}.ts`
- `apps/api/test/int/{booking,cancel,appointments,concurrency,same-day-booking}.test.ts`

## Deliverables
1. **Create** per §6.1, steps 1–8, in this order. Notes:
   - Validation errors in step 1 are thrown *before* any event is written, except that `SLOT_REQUESTED` is written once the
     request is structurally valid and resolves to real entities.
   - The advisory lock key is `hashtext(dealership_id || ':' || local_date)` via `pg_advisory_xact_lock` inside the
     transaction. The in-tx `DayContext` must be re-loaded inside the transaction (not reused from step 1).
   - Same-day parts reservation uses the conditional `UPDATE … WHERE on_hand - reserved >= qty` and checks the row count.
   - Events after a rollback (`CHECK_FAILED`) are written in a separate statement after the transaction ends.
   - `Idempotency-Key`: if an appointment with that key exists, return it with **200** (no new events). Two concurrent
     requests with the same key must still yield exactly one row (unique constraint → fetch and return the existing one).
   - Reference via `appointment_ref_seq` and the dealership-local start date (SPEC §4).
   - 201 body = `AppointmentDetail` (same mapper as the detail endpoint).
2. **List** `GET /appointments?customerId=&status=` → upcoming first (start ≥ now ascending), then past (descending).
3. **Detail** `GET /appointments/{reference}` → `AppointmentDetail` incl. parts and `history` ordered by `occurred_at, id`.
   History = events by `appointment_id` **plus** events of the same `booking_session_id` written before creation (so the
   failed attempt shows up, as in design 03). `summary` strings (history.ts), matching design 03 wording:
   - SLOT_REQUESTED → `Requested 10:00–12:00`
   - CHECK_FAILED → `Check failed: no Brakes-qualified technician free for the full window. Five alternatives offered.`
     (reason-specific: NO_BAY → `no suitable bay free…`, FULLY_BOOKED → `no bay or qualified technician free…`,
     SAME_DAY_QUOTA_REACHED → `same-day capacity for this window is full…`, PARTS_UNAVAILABLE → `parts not in stock…`;
     number of alternatives spelled out one–five, or `No alternatives available.`)
   - CHECK_PASSED → `Check passed: Bay 2 and Riya Patel free 13:00–15:00`
   - RESOURCES_RESERVED → `Bay and technician reserved together` (+ ` · parts reserved` for same-day with parts)
   - APPOINTMENT_CREATED → `Appointment record created · confirmation sent` (seeded rows: `Appointment record created`)
   - APPOINTMENT_CANCELLED → `Cancelled by customer` (+ `: <reason>`), CHECKED_IN → `Checked in`,
     APPOINTMENT_NO_SHOW → `Released: not checked in within 15 minutes` (use the dealership grace)
4. **Cancel** per §6.2 (release parts, event, idempotent for already-cancelled, 409 for past / NO_SHOW).

## Acceptance criteria (integration tests against real Postgres, fixed clocks)
- [ ] Happy path: 201, row persisted with the engine-chosen tech/bay (T9: brake → TEC-03/BAY-01 on an empty day), events
      `SLOT_REQUESTED, CHECK_PASSED, RESOURCES_RESERVED, APPOINTMENT_CREATED` in order.
- [ ] Unavailable → 409 `SLOT_UNAVAILABLE` with `reason` and ≤5 `alternatives`; `CHECK_FAILED` persisted despite rollback.
- [ ] **Concurrency:** 20 parallel requests for the same window, capacity 1 (make only one qualified tech free) → exactly
      1×201, 19×409, exactly one CONFIRMED row. Capacity 2 → exactly 2×201. Use distinct vehicles per request.
- [ ] Same `Idempotency-Key` sequentially → second call 200, same reference, one row; and concurrently → one row.
- [ ] Vehicle already booked in an overlapping window at another dealership → 409 `VEHICLE_ALREADY_BOOKED`.
- [ ] Validation → 422 codes: `MISALIGNED_START` (10:15), `OUTSIDE_OPENING_HOURS` (16:00 brake), weekend → `DEALERSHIP_CLOSED`, past date and > 30 days
      (`OUTSIDE_BOOKING_HORIZON`), `VEHICLE_NOT_OWNED`, `SERVICE_NOT_APPLICABLE` (oil change on VEH-02).
- [ ] Same-day (clock 09:10 local): oil change at 11:30 → 201 `channel: SAME_DAY`, inventory `reserved` +1 per part line,
      `parts` in body; brake today → 422 `SERVICE_NOT_EXPRESS`; 11:00 → 422 `LEAD_TIME_NOT_MET`; DLR-02 oil for VEH-01 → 409
      `PARTS_UNAVAILABLE`.
- [ ] Same-day quota: 10 parallel same-day requests for overlapping windows with plenty of free resources → exactly
      `quotaCap` (1) succeed, the rest 409 `SLOT_UNAVAILABLE` with `reason: SAME_DAY_QUOTA_REACHED`.
- [ ] Parts race: set stock of a required part to 1; two parallel same-day oil changes at non-overlapping times (different
      vehicles) → exactly one 201 and one 409 `PARTS_UNAVAILABLE`; `reserved` never exceeds `on_hand`.
- [ ] Cancel frees the window (re-book succeeds) and releases parts; cancelling a past appointment → 409; double cancel → 200.
- [ ] Detail history matches the design-03 sequence for a fail-then-succeed flow sharing one `bookingSessionId`.
- [ ] **Mutation check (report it):** temporarily remove the advisory lock call, run the concurrency test, confirm it still
      never double-books (the exclusion constraint + 23P01 mapping hold the invariant) and whether any status codes change;
      then restore the lock. Paste the observed output in your report.
- [ ] `pnpm verify` green.

Finish with the report format from `CLAUDE.md` and commit on your worktree branch.
