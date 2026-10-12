# Brief W5-A8 — Reschedule backend (backend-dev)

Read first: `AGENT.md`, `CLAUDE.md`, `docs/SPEC.md` **§6.5** (and §6.1, §6.2 it refers to),
`docs/adr/006-reschedule-in-place.md`, `docs/adr/002-double-booking-prevention.md`. Run `pnpm install` first.

## Goal
`POST /appointments/{reference}/reschedule` exactly as SPEC §6.5, plus `excludeReference` on the availability endpoint
(§6, under the availability response). Reviewers will probe this the way they probed booking: concurrency, the
"overlaps only itself" case, parts across channel changes, and the audit trail.

## Building blocks (read-only unless listed under *Owns*)
- `src/services/day-plan.ts` (Opus): `resolveDayPlan(db|tx, clock, { …, excludeAppointmentId?, partsHeld? })` —
  `excludeAppointmentId` removes that appointment from the DayContext, from the vehicle-overlap set used by
  `loadAlternatives`, and from the same-day quota; `partsHeld: true` makes the same-day parts check pass (the appointment
  already holds its reservation). `loadAlternatives(db, clock, plan, afterStartMin)` honours the plan's exclusion.
- `src/services/booking.ts`: follow its structure — validation before the tx, `CheckFailure` thrown inside the tx and
  turned into `CHECK_FAILED` + 409 after rollback, `pgConstraint` / `pgErrorCode` for `23P01`, telemetry wrapper.
  You may extract shared validation (grid, opening hours, same-day express/lead time) into a helper **inside
  `booking.ts`** and export it, but booking behaviour and its tests must stay unchanged.
- `src/services/parts-release.ts` `releaseParts(tx, appt, now)`; `src/services/appointment-query.ts`
  `getAppointmentDetail`; `src/domain/time.ts`; `src/domain/errors.ts` `DomainError`.
- `src/observability/metrics.ts` + `telemetry.ts`: add `reschedule_attempts_total{outcome,reason}` and a
  `rescheduleAttempt(...)` method mirroring `bookingAttempt`; span name `booking.reschedule`.

## Owns
- `apps/api/src/services/reschedule.ts`, `apps/api/src/routes/reschedule.ts` (replace the 501 stub)
- `apps/api/test/int/reschedule.test.ts`, `apps/api/test/int/reschedule-concurrency.test.ts`
- Additive edits only, listed in your report: `services/booking.ts` (extract/export a validation helper),
  `services/history.ts` (`APPOINTMENT_RESCHEDULED` summary), `services/availability.ts` + `routes/availability.ts`
  (`excludeReference` → look up id, 404 unknown, 422 `RESCHEDULE_SCOPE_MISMATCH` when dealership/service/vehicle differ,
  pass `excludeAppointmentId` and `partsHeld`), `observability/{metrics,telemetry,otel-telemetry}.ts` (new counter),
  `test/int/availability.test.ts` (add `excludeReference` tests), `docs/requests.http`, `docs/curl-examples.md`
  (one reschedule walkthrough step each), `docs/openapi.yaml` (regenerate with
  `pnpm --filter @scheduler/api openapi:export`, never hand-edit).

## Acceptance criteria
- [ ] R1–R15 from SPEC §6.5 each a named test (`it('R7 target window taken …')`), all green.
- [ ] Availability `excludeReference`: the appointment's own window shows `AVAILABLE`; unknown → 404; mismatch → 422.
- [ ] History renders the §6.5 summary for same-day and cross-day moves (assert exact strings).
- [ ] `/metrics` exposes `reschedule_attempts_total` and it moves for a 200 and a 409 (extend `test/int/observability.test.ts`
      only if needed — list it).
- [ ] Mutation checks in your report, each with the failing test name, then restored:
      (a) don't pass `excludeAppointmentId` → R2 and R14 fail;
      (b) lock only the new day → R13 or R11 still green? report what happens (the constraint is the backstop);
      (c) skip the parts release on SAME_DAY → ADVANCE → R5 fails.
- [ ] `pnpm verify` green; `pnpm e2e` still green.

Commit on your worktree branch: `W5-A8: reschedule in place`. Final report per `AGENT.md`.
