# Brief W3-A7 — Late-arrival policy (check-in + no-show sweeper)

You are a Sonnet agent implementing **one work package**. Read `CLAUDE.md`, `docs/SPEC.md` §2 (A10, A14), §6.3, §6.4 and
`docs/adr/005-same-day-express-policy.md`. Run `pnpm install` first.

## Building blocks (read-only)
- `src/services/parts-release.ts` (Opus): `releaseParts(tx, { id, dealershipId }, now)` — call it after the status transition.
- `src/services/appointment-query.ts` (A4): `getAppointmentDetail(db, reference)` for response bodies.
- `src/services/history.ts` (A4) already renders `CHECKED_IN` and `APPOINTMENT_NO_SHOW` summaries — check them and use the
  `detail` keys it expects (read the file; if a summary is missing, report it rather than editing history.ts).
- `src/services/cancellation.ts` (A4) — follow its transaction + status-guard pattern (`UPDATE … WHERE status = 'CONFIRMED'`).
- `test/helpers/**`, `src/clock.ts` (`manualClock` for moving time in tests).

## You own
- `apps/api/src/routes/check-in.ts` (replace the 501 stub; keep `checkInRoutes`)
- `apps/api/src/services/{check-in,no-show-sweeper}.ts`
- `apps/api/test/int/{check-in,no-show}.test.ts`
- **One** registration block in `apps/api/src/server.ts` to start the sweeper (not in `app.ts`; tests build the app without it).
  Another agent (A5) may also edit `server.ts` — keep your change minimal and self-contained.

## Deliverables (SPEC §6.3)
1. `POST /appointments/{reference}/check-in` → 200 `AppointmentDetail` with `checkedInAt`, event `CHECKED_IN`.
   - Not CONFIRMED, or already checked in → 409 `APPOINTMENT_NOT_ACTIVE`. Unknown → 404.
   - `channel = SAME_DAY` and `now > start_at + late_grace_min` → in one transaction set `NO_SHOW`, release parts, write
     `APPOINTMENT_NO_SHOW` (`detail: { reason: 'LATE_ARRIVAL', graceMin }`), then respond 409 `LATE_ARRIVAL` with a detail like
     "Arrived 16 minutes after the 08:30 start; same-day bookings are released after 15 minutes."
   - Checking in *early* is allowed. Advance bookings are never auto-released.
2. `releaseLateSameDay(db, clock) → { released: string[] }` — marks every CONFIRMED same-day appointment with
   `checked_in_at IS NULL` and `now > start_at + grace` (grace from its dealership) as `NO_SHOW`, releases parts, writes the
   event; each row in its own guarded transaction so a concurrent check-in or cancel wins cleanly. Logs a summary line.
3. `startNoShowSweeper({ db, clock, log, intervalMs = 60_000 }) → stop()` using `setInterval` (unref'd); `server.ts` starts it
   unless `NODE_ENV === 'test'` and stops it on shutdown.

## Acceptance criteria (integration tests, `manualClock`)
- [ ] Same-day booked 11:30: check-in at 11:40 → 200, `CHECKED_IN` in history; second check-in → 409 `APPOINTMENT_NOT_ACTIVE`.
- [ ] Same-day at start + 16 min → 409 `LATE_ARRIVAL`; status `NO_SHOW`; parts released (`inventory.reserved` back, `released_at` set);
      the same window is bookable again (book it through `POST /appointments` to prove resources were freed).
- [ ] Exactly at start + 15 min → still allowed (grace is inclusive).
- [ ] Advance booking checked in at start + 30 → 200.
- [ ] Sweeper: marks only CONFIRMED, unchecked, same-day, past-grace rows; leaves advance, checked-in, cancelled and in-grace
      rows alone; idempotent on a second run; a check-in racing the sweeper ends in exactly one outcome.
- [ ] Cancelled / NO_SHOW appointment check-in → 409 `APPOINTMENT_NOT_ACTIVE`.
- [ ] `pnpm verify` green **and its exit code is 0** (check `$?`, not grep output).

Finish with the report format from `CLAUDE.md` and commit on your worktree branch.
