# Brief W1-F1 — Web shell + Book screen (on MSW)

You are a Sonnet agent implementing **one work package**. Read `CLAUDE.md`, `docs/SPEC.md` §6 and §8, and the design
file `design/screens/01-book-a-service.html` (markup, inline styles **and** the `<script type="text/x-dc">` mock logic).
Also skim `02-service-board.html` and `03-appointment-record.html` for the shared header. Run `pnpm install` first.

## Goal
A faithful implementation of design 01 (Book a service) inside an app shell, running entirely on MSW mocks typed by
`@scheduler/contracts`, plus a complete typed API layer that later screens and the real backend will use.

## You own
- Everything under `apps/web/**` **except** `apps/web/src/screens/{record,list,board}/**` — but you must create
  placeholder components there so the router compiles: `src/screens/record/index.tsx` → `export function RecordScreen()`,
  `src/screens/list/index.tsx` → `export function AppointmentsScreen()`, `src/screens/board/index.tsx` →
  `export function BoardScreen()` (a heading + "Coming in Wave 2"). F2 will replace them.

Installed deps you may use: react 19, react-router-dom 7, @tanstack/react-query 5, msw 2, @fontsource-variable/archivo,
@fontsource/ibm-plex-mono, vitest, @testing-library/react + user-event + jest-dom, jsdom. No others.

## Deliverables
1. **Styling foundation:** `src/styles/tokens.css` (SPEC §8 tokens as CSS custom properties), `global.css` (body, focus ring,
   button reset, fonts). CSS modules per component; translate the design's inline styles faithfully (spacing, sizes,
   `font-stretch`, mono labels, hatched unavailable slots, dark summary aside, orange CTA). Archivo must render with the
   width axis (check which `@fontsource-variable/archivo` CSS entry includes `wdth`).
2. **App shell:** router (`/` → redirect `/book`, `/book`, `/appointments`, `/appointments/:reference`, `/board`), header
   from the design (logo squares, title, nav with `aria-current="page"`, user chip "LT · Linh Tran"), QueryClientProvider.
3. **API layer** (`src/api/`): `client.ts` — `fetch` wrapper on `VITE_API_URL`, parses JSON with the contract schemas,
   turns `application/problem+json` into `ApiError { status, problem: Problem }`. `hooks.ts` — TanStack hooks for **every**
   SPEC §6 endpoint (dealerships, service types, customer, vehicles, availability, create/list/get/cancel appointment,
   check-in, board, inventory list/update) with sensible query keys and invalidation (create/cancel/check-in invalidate
   availability, appointments and board). Use `paths` from contracts — never hand-write URLs.
4. **Mocks** (`src/mocks/`): MSW handlers for **every** endpoint backed by an in-memory store seeded from
   `@scheduler/contracts/fixtures` (`store.ts`), split by resource: `handlers/{reference,availability,appointments,board,inventory}.ts`.
   Availability is generated deterministically per (dealer, service, date) — port the design's `busyFor`/`check` approach
   and apply the SPEC §5 rules (statuses, assignment preference, same-day lead time 120 → earliest start, quota, express-only,
   powertrain applicability → 422). POST creates an appointment in the store (so the record link works) and makes that window
   busy. Scenario switches via the page URL query `?mock=…`: `conflict` (next POST → 409 `SLOT_UNAVAILABLE` with 5 alternatives,
   then normal), `parts` (today → `PARTS_UNAVAILABLE`), `cutoff` (today → `PAST_CUTOFF`), `morning` (mock "now" = 09:10 local
   today so same-day slots exist regardless of real time). Start the worker in `main.tsx` when `VITE_USE_MOCKS !== 'false'`.
   Export the handlers for reuse with `msw/node` in tests.
5. **Book screen** (`src/screens/book/`) implementing SPEC §8 "Book screen behaviour" completely: numbered sections
   01 Vehicle / 02 Service / 03 Dealership / 04 Date and time; legend; slot grid with status labels; "no open time" panel;
   same-day Today chip, notice, Express labels, quota-full slots, the three `sameDay.blocked` panels; summary aside with
   availability check list (proposed bay + tech + "Full duration covered"); Confirm → "Checking bay and technician…"
   (disabled, `aria-busy`); 201 → confirmation panel (design's second state) with "View appointment record" linking to
   `/appointments/:reference` and "Book another service"; 409 → warning panel with the `detail`, alternatives as buttons
   (clicking selects that date + time) and availability refetch; other errors → inline error. New `bookingSessionId`
   (`crypto.randomUUID()`) per flow, reused across retries within the flow. Customer id from `VITE_CUSTOMER_ID`.
6. **Tests** (vitest + Testing Library + `msw/node`): slot status → label/disabled/aria-label mapping; changing service clears
   the slot and auto-selects the first available; EV vehicle hides OIL_CHANGE and ICE hides EV_BATTERY_CHECK; Today +
   brake shows the SERVICE_NOT_EXPRESS panel; full happy path renders the confirmation; 409 path renders alternatives and
   choosing one updates the selection.

## Acceptance criteria
- [ ] Every design-01 state and every same-day state is reachable in the browser (`pnpm --filter @scheduler/web dev`).
- [ ] Keyboard-only booking works; `aria-pressed` on choice buttons; disabled slots carry an `aria-label` with the reason.
- [ ] Layout holds at 1440 px and 390 px wide (no horizontal page scroll at 390 px).
- [ ] No hand-written URLs or response types — everything from `@scheduler/contracts`.
- [ ] Tests listed above green; `pnpm verify` green; `pnpm --filter @scheduler/web build` succeeds.

## Out of scope
Record / list / board screens (placeholders only), real API wiring beyond `VITE_API_URL`, e2e tests.

Finish with the report format from `CLAUDE.md` and commit on your worktree branch.
