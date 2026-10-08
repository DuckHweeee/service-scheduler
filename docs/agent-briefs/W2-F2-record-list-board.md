# Brief W2-F2 — Appointment record, My appointments, Service board (on MSW)

You are a Sonnet agent implementing **one work package**. Read `CLAUDE.md`, `docs/SPEC.md` §6 and §8, the design files
`design/screens/02-service-board.html` and `03-appointment-record.html`, and the existing web app built in W1 (app shell,
`src/api/hooks.ts`, `src/mocks/**`, `src/styles/tokens.css`, the Book screen for conventions). Run `pnpm install` first.

## You own
- `apps/web/src/screens/{record,list,board}/**` (replace the placeholders; keep the exported component names
  `RecordScreen`, `AppointmentsScreen`, `BoardScreen`)
- `apps/web/src/mocks/handlers/{appointments,board}.ts` (extend only if a scenario below needs it)

Read-only: everything else under `apps/web` (if a shared component or hook is missing, build a local one inside your
screen folder and mention it in the report).

## Deliverables
1. **Appointment record** (`/appointments/:reference`, design 03): breadcrumb; dark header with status badge (Confirmed /
   Cancelled / No-show / Checked in), reference, service name, long date · time range · dealership; actions:
   **Add to calendar** (client-side `.ics` download: UID = reference, DTSTART/DTEND in UTC, SUMMARY, LOCATION),
   **Reschedule** (disabled, `title="Coming soon"`), **Cancel appointment** (in-page confirmation dialog — a real
   `<dialog>` or ARIA dialog with focus trap; never `window.confirm`; optional reason; on success the page shows the cancelled
   state). Hide/disable actions that don't apply to the status. "Linked to this appointment" four cards (customer, vehicle,
   technician with required-skill chip "✓ required", service bay). "Appointment record · Stored fields" table (snake_case keys
   as in the design). "How it was booked" timeline from `history` (time `HH:mm:ss` local, summary; last item bold).
   Same-day appointments show an "Express · same-day" tag and the late-arrival notice using `lateGraceMin`. Parts list
   when non-empty. 404 → friendly not-found panel with a link to My appointments.
2. **My appointments** (`/appointments`): tabs or segmented control Upcoming / Past / Cancelled & no-show; rows show
   date, time range, service, dealership, vehicle, status; each links to the record; empty states; "Book a service" CTA.
3. **Service board** (`/board`, design 02): dealership select, date heading, Previous day / Today / Next day buttons; timeline
   grid `210px repeat(18, minmax(52px, 1fr))` for 08:00–17:00 (derive columns from `opensAt`/`closesAt`), hour labels,
   section labels SERVICE BAYS / TECHNICIANS, row headers (name + bay kind or skills), blocks placed by start/end
   (half-hour columns; 45-minute jobs span to the next column boundary visually but keep the exact times in the label), block
   text `NNNN · Service` (last 4 digits of reference), same-day blocks tagged "Express", NO_SHOW blocks struck-through and
   muted, today's CONFIRMED blocks without check-in have a **Check in** button (calls the check-in hook; show the result —
   success or `LATE_ARRIVAL` problem detail — in a live region). Blocks link to the record. Legend. Horizontal scroll inside
   the timeline only. The "incoming request / rejected / reserved" panels are **not** built.
4. **Tests:** timeline placement (start/end → grid columns, incl. 45-minute and back-to-back), record renders history in order
   and the cancel dialog flow (confirm → cancelled state; Escape closes), list tab filtering, check-in shows `LATE_ARRIVAL`.

## Acceptance criteria
- [ ] All three screens reachable from the header nav and from links on the Book confirmation.
- [ ] Cancel flow updates record, list and board via query invalidation (no full reload).
- [ ] Board scrolls horizontally at 390 px without page-level horizontal scroll; keyboard reachable blocks and buttons.
- [ ] Visual fidelity to designs 02/03 (spacing, type, colours, mono labels).
- [ ] Tests green; `pnpm verify` green; `pnpm --filter @scheduler/web build` succeeds.

Finish with the report format from `CLAUDE.md` and commit on your worktree branch.
