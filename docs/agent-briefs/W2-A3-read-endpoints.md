# Brief W2-A3 — Read endpoints (reference, availability, board, inventory)

You are a Sonnet agent implementing **one work package**. Read `CLAUDE.md`, `docs/SPEC.md` (§2, §5.4, §6, §7) and the
shared building blocks below. Run `pnpm install` first.

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
- `src/domain/availability` (A2) — `computeSlots`.
- `src/db/repositories/**`, `src/domain/time.ts`, `test/helpers/**` (A1) — read their header comments.

## You own
- `apps/api/src/routes/{reference,availability,board,inventory}.ts`
- `apps/api/src/services/{availability,board,inventory}.ts`
- `apps/api/test/int/{reference,availability,board,inventory}.test.ts`

## Deliverables
Every route declares zod `querystring`/`params`/`body` and `response` schemas from `@scheduler/contracts` (so they appear
in `/docs`) and uses the `routes` patterns from contracts.
1. `GET /dealerships`, `GET /service-types`, `GET /customers/{id}`, `GET /customers/{id}/vehicles`.
2. `GET /dealerships/{id}/availability?serviceType=&date=&vehicleId=` → `AvailabilityResponse`: `resolveDayPlan` →
   if not a working day: `isWorkingDay: false`, `slots: []`; if `sameDay.blocked`: `slots: []`; else `computeSlots` → DTOs
   (`proposed` ids resolved to names, `startAt` with dealership offset, `isExpress` = same-day).
3. `GET /dealerships/{id}/board?date=` → `BoardResponse`: all bays and technicians (idle ones too), blocks for CONFIRMED and
   NO_SHOW appointments of that local date, sorted by start. No horizon restriction (past days allowed).
4. `GET /dealerships/{id}/inventory` and `PUT /dealerships/{id}/inventory/{sku}` (`onHand` below `reserved` → 409
   `STOCK_BELOW_RESERVED`; unknown sku for that dealership → 404). `available = onHand - reserved`.

## Acceptance criteria (integration tests, fixed clocks)
- [ ] Availability for a seeded day equals `computeSlots` on the `DayContext` from `loadDayContext` (golden test).
- [ ] Unknown dealership / service / vehicle → 404; date outside horizon → 422 `OUTSIDE_BOOKING_HORIZON`; weekend → 200,
      `isWorkingDay: false`, empty slots.
- [ ] DLR-03 + WHEEL_ALIGNMENT → every slot `NO_QUALIFIED_TECHNICIAN`.
- [ ] Same-day (clock 2026-10-08T09:10+07:00, a Thursday): OIL_CHANGE + VEH-01 at DLR-01 → first slot 11:30, `isExpress: true`,
      `sameDay.earliestStartTime: '11:30'`, `quotaCap: 1`; BRAKE today → `blocked: SERVICE_NOT_EXPRESS`; DLR-02 + OIL_CHANGE +
      VEH-01 today → `PARTS_UNAVAILABLE`; clock 15:20 → `PAST_CUTOFF`; tomorrow → `sameDay: null`.
- [ ] OIL_CHANGE + VEH-02 (EV) → 422 `SERVICE_NOT_APPLICABLE`.
- [ ] `PUT inventory` FLT-OIL-CX22 at DLR-01 to 0 → same-day oil change for VEH-01 becomes `PARTS_UNAVAILABLE`; setting
      below `reserved` → 409.
- [ ] Board: returns 5 bays + 4 technicians for DLR-01, blocks sorted, CANCELLED excluded, NO_SHOW included.
- [ ] Every route's response passes its contract schema (the serializer enforces this — add one test that a malformed
      query returns 400 `VALIDATION_ERROR`).
- [ ] `pnpm verify` green.

Finish with the report format from `CLAUDE.md` and commit on your worktree branch.
