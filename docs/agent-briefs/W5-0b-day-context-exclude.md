# W5-0b — `loadDayContext` can exclude one appointment (db-architect)

Read first: `AGENT.md`, `CLAUDE.md`, `docs/SPEC.md` §4–§5, `apps/api/src/db/repositories/day-context.ts`.

## Why
Reschedule (SPEC v0.3 §6.5, being written in parallel by Opus) re-checks a window **as if the appointment being moved
did not exist**: its bay, technician and same-day quota share must count as free. The engine stays pure; the
exclusion happens where busy intervals are read.

## Owns
- `apps/api/src/db/repositories/day-context.ts`
- `apps/api/test/int/db.repositories.test.ts` (add tests only; keep existing ones unchanged)

No migration, no schema change, no other file. Anything else needed → stop and report.

## Deliverable
`LoadDayContextOptions` gains `excludeAppointmentId?: string`. When set, the row with that `appointments.id` is left
out of `busyByBay`, `busyByTech` **and** `sameDayBusy`. Omitted → behaviour identical to today (every existing caller
compiles and behaves unchanged).

## Acceptance criteria
- [ ] Int test: two CONFIRMED appointments on one day (one ADVANCE, one SAME_DAY); excluding the SAME_DAY one removes
      its interval from its bay, its technician and `sameDayBusy`, and leaves the other appointment untouched.
- [ ] Int test: excluding an id that is not on that day (or does not exist) changes nothing.
- [ ] Mutation check in your report: drop the exclusion filter → the first test goes red (paste the failing output line).
- [ ] `pnpm verify` green.

Commit on your worktree branch: `W5-0b: loadDayContext excludeAppointmentId`. Final report per `AGENT.md`.
