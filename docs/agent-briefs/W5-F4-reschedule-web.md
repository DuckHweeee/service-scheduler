# Brief W5-F4 — Reschedule screen (frontend-dev, on MSW)

Read first: `AGENT.md`, `CLAUDE.md`, `docs/SPEC.md` **§6.5** and §8, `docs/adr/006-reschedule-in-place.md`,
`design/screens/01-book-a-service.html` (visual language to reuse) and `03-appointment-record.html`. Run `pnpm install`.

## Goal
A customer can move an upcoming appointment from its record page to another date/time, with the same slot grid,
states and copy quality as the Book screen. Works on MSW now; the backend (A8) lands in parallel against the same
contracts.

## Owns
- `apps/web/src/screens/reschedule/**` (new screen + tests)
- `apps/web/src/screens/record/index.tsx` and its test: the Reschedule button (remove `disabled`/"Coming soon"; render it
  as a link to `/appointments/:reference/reschedule`, shown only when status `CONFIRMED`, not checked in, start in the future
  — the same rule `canCancel` already uses), plus history rendering if `APPOINTMENT_RESCHEDULED` needs an icon/label.
- `apps/web/src/api/hooks.ts`: `useRescheduleAppointment()` (invalidates the appointment detail, list and board keys);
  `useAvailability` accepts optional `excludeReference`.
- `apps/web/src/mocks/**`: reschedule handler (moves the stored appointment, writes the history entry with the §6.5
  summary, 409 under `?mock=conflict`), availability honours `excludeReference`.
- `apps/web/src/App.tsx`: one route line.
- `e2e/06-reschedule.spec.ts` (runs against the real API — it will only pass once A8 is merged; write it now, mark it
  `test.fixme` with a comment, Opus un-fixmes it at the A8+F4 integration gate).

## Screen
- Header: "Reschedule {service}" + reference; a "Current" card (date, time, bay, technician, dealership); vehicle,
  service and dealership are fixed (not editable).
- Reuse `screens/book/` pieces — `SlotGrid`, `labels.ts`, the date strip (Today chip + next working days, same-day
  notice, `sameDay.blocked` panels). Extract shared bits into `screens/book/` exports only if needed and keep the Book
  screen's tests green; list such edits in your report.
- Availability is requested with `excludeReference`; the current slot is marked "Current" and is not selectable;
  first other `AVAILABLE` slot auto-selected like Book.
- Confirm button "Move appointment" → "Checking bay and technician…" → on 200 navigate to the record with a notice
  "Appointment moved to {date} {time}."; on 409 show the warning panel with alternatives as buttons (same component
  behaviour as Book) and refetch; on 422 show the problem `detail`.
- Layout holds at 1440 px and 390 px; keyboard-only flow works; buttons use `aria-pressed`, disabled slots have
  `aria-label` with the reason (as on Book).

## Acceptance criteria
- [ ] Component tests: button visibility rule on record; current slot marked and disabled; 409 shows alternatives and
      picking one resubmits; success navigates to the record and shows the notice + "Rescheduled from …" history line.
- [ ] Book, Record, List, Board tests unchanged and green.
- [ ] Screenshots `docs/screenshots/reschedule-1440.png` and `reschedule-390.png` (extend `e2e/05-screenshots.spec.ts` only if
      it already supports MSW mode; otherwise report how you captured them).
- [ ] `pnpm --filter @scheduler/web typecheck && pnpm --filter @scheduler/web test && pnpm --filter @scheduler/web build`
      and `pnpm verify` green.

Commit on your worktree branch: `W5-F4: reschedule screen`. Final report per `AGENT.md`.
