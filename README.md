# Unified Service Scheduler

Keyloop technical assessment — **Scenario A**. A service-appointment scheduler that confirms a booking **only** when a
suitable service bay **and** a technician qualified for the job are both free for the **entire** duration, and persists an
appointment linking customer, vehicle, technician and bay. Includes same-day "express" booking with lead time, capacity
quota, parts-in-stock check and late-arrival release.

**Implemented layer: backend** (REST API + PostgreSQL, fully tested). The web app is a client harness built from the
provided UI design; it runs against the real API or against mocks.

| | |
|---|---|
| ![Book a service](docs/screenshots/book-1440.png) | ![Service board](docs/screenshots/board-1440.png) |
| ![Appointment record](docs/screenshots/record-1440.png) | ![Same-day express](docs/screenshots/book-today-morning-1440.png) |

## Deliverables

| Deliverable | Where |
|---|---|
| System Design Document | [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) (architecture diagram, components, data flow, technology choices, observability, GenAI in design) |
| Detailed spec / contract | [`docs/SPEC.md`](docs/SPEC.md) · decisions in [`docs/adr/`](docs/adr/) |
| API contract | Swagger UI at `/docs` · [`docs/openapi.yaml`](docs/openapi.yaml) · [`docs/requests.http`](docs/requests.http) · [`docs/curl-examples.md`](docs/curl-examples.md) |
| Observability | [`docs/observability.md`](docs/observability.md) |
| AI Collaboration Narrative | [below](#ai-collaboration-narrative) · full log [`docs/ai-log.md`](docs/ai-log.md) · agent prompts [`docs/agent-briefs/`](docs/agent-briefs/) |

## Prerequisites

- **Node.js 22+** and **pnpm 10** (`corepack enable` provides the pinned version).
- **No Docker required.** PostgreSQL 18 runs from the [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres)
  npm package (binaries for macOS arm64/x64 and Linux). If you prefer Docker: `docker compose up -d postgres` exposes the
  same port and credentials.

## Build and run

```bash
corepack enable
pnpm install

# terminal 1 — database (embedded PostgreSQL 18 on :54329, data in .pgdata/; Ctrl-C stops it)
pnpm db:up

# terminal 2 — schema + demo data, then API + web against the real API
pnpm db:migrate && pnpm db:seed
pnpm dev:real            # API http://localhost:3000 (Swagger: /docs, metrics: /metrics) · web http://localhost:5173
```

Other modes:

| Command | What it runs |
|---|---|
| `pnpm dev:mock` | Web only, on in-browser mocks (MSW) — no database needed. Scenario switches: `?mock=conflict`, `?mock=parts`, `?mock=cutoff`, `?mock=morning` |
| `pnpm dev` | API + web; web uses mocks unless `VITE_USE_MOCKS=false` |
| `CLOCK_OVERRIDE=2026-10-08T09:10:00+07:00 pnpm --filter @scheduler/api dev` | API with a pinned "now" — useful for demonstrating same-day rules at any time of day |
| `docker compose --profile obs up -d jaeger` + `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` | Traces in Jaeger at http://localhost:16686 |
| `pnpm --filter @scheduler/web build` | Production build of the web app |

Configuration is environment-only; see [`.env.example`](.env.example). Defaults work for local development.

The seed is deterministic and relative to today: three dealerships (DLR-03 deliberately has no alignment-qualified
technician, DLR-02 is out of the Crossover oil filter for the parts demo), eight service types, the demo customer
**Linh Tran (CUS-10482)** with a 2022 Crossover LX (ICE) and a 2024 Compact EV, and ~30% background load for the next
ten working days.

## Test

```bash
pnpm verify              # typecheck + lint + all unit/integration tests (exit code is what CI uses)
pnpm --filter @scheduler/api test:unit     # pure engine + time + seed (fast)
pnpm --filter @scheduler/api test:int      # integration tests against a real, ephemeral PostgreSQL
pnpm e2e                 # Playwright: real API + real DB + web (see e2e/README.md)
```

`pnpm e2e` uses Playwright's bundled Chromium (`pnpm exec playwright install chromium` once). On macOS 12, where that
Chromium is unsupported, point it at an installed Chrome:
`PW_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm e2e`.

What the suites cover (~230 unit/integration tests, 13 e2e specs):

- **Availability engine** — every rule in the spec's test table (T1–T21: full-duration overlap, back-to-back, skills, bay
  types, assignment preference, same-day lead time/quota/cutoff), property-based tests that re-derive every slot status
  independently, 100% line and branch coverage.
- **Booking under concurrency** — 20 parallel requests for one free slot → exactly one 201 and one row; capacity 2 → exactly
  two; same-day quota races; parts-stock races; concurrent idempotent retries; check-in vs no-show sweeper races.
- **Database invariants** — exclusion constraints reject overlapping technician / bay / vehicle bookings; composite foreign
  keys stop cross-dealership assignment; inventory can never be over-reserved.
- **API behaviour** — every endpoint and error code (problem+json), audit history wording, metrics.
- **Web** — component tests on mocks; e2e journeys (book → record → cancel; conflict → alternatives; same-day express;
  board check-in) plus screenshots at 1440 and 390 px.

Integration tests never mock the database: a vitest global setup starts an ephemeral PostgreSQL on a random port and each
test file gets its own database cloned from a migrated template.

## API at a glance

| Method & path | Purpose |
|---|---|
| `GET /api/v1/dealerships/{id}/availability?serviceType&date&vehicleId` | Slot grid for a day: status per 30-min start + proposed bay/technician |
| `POST /api/v1/appointments` (`Idempotency-Key` optional) | Book: 201, or 409 `SLOT_UNAVAILABLE` with `reason` and up to 5 alternatives |
| `GET /api/v1/appointments/{reference}` | Appointment with customer, vehicle, technician, bay, parts and booking history |
| `GET /api/v1/appointments?customerId` | Customer's appointments |
| `POST /api/v1/appointments/{reference}/cancel` | Cancel and free resources |
| `POST /api/v1/appointments/{reference}/check-in` | Advisor check-in; late same-day arrivals are released |
| `GET /api/v1/dealerships/{id}/board?date` | Day timeline per bay and technician |
| `GET/PUT /api/v1/dealerships/{id}/inventory[/{sku}]` | Parts stock (stands in for a DMS feed) |
| `GET /api/v1/dealerships`, `/service-types`, `/customers/{id}`, `/customers/{id}/vehicles` | Reference data |

Errors are RFC 7807 `application/problem+json` with a stable `code`. Full contract: `/docs` or
[`docs/openapi.yaml`](docs/openapi.yaml).

## How double booking is prevented

1. **Engine:** a window is bookable only if some bay of an allowed type **and** some technician with the required skill are
   free for the whole half-open interval `[start, end)`.
2. **Transaction:** the booking takes a PostgreSQL advisory lock for that dealership-day, re-reads the schedule inside the
   transaction and re-checks before inserting (correct reason, alternatives and same-day quota under contention).
3. **Database:** `EXCLUDE USING gist` constraints on `(technician_id, during)`, `(service_bay_id, during)` and
   `(vehicle_id, during)` for confirmed appointments make an overlap impossible even if (1) or (2) were wrong. Tested by
   removing the lock: still never double-books. See [ADR-002](docs/adr/002-double-booking-prevention.md).

## Repository layout

```
packages/contracts   zod schemas, enums, URL paths, fixtures — shared by API and web
apps/api             Fastify API: routes → services → pure domain (availability engine, same-day policy, time)
  drizzle/           migrations (incl. hand-written EXCLUDE constraints)
  test/              unit + integration (real PostgreSQL)
apps/web             React app: Book, My appointments, Appointment record, Service board; MSW mocks
e2e/                 Playwright specs with their own DB/API/web stack
design/              the original UI design bundle and the extracted screens
docs/                system design, spec, ADRs, observability, API docs, AI log, agent briefs, screenshots
```

## Known limitations

- No authentication: the web acts as customer CUS-10482; the service board is an unauthenticated advisor view.
- The web decides "today" from the browser clock in the dealership's timezone; with `CLOCK_OVERRIDE` on the API, use a
  browser clock that matches (the e2e suite pins both). Same-day panels themselves follow the server's answer.
- Check-in is not time-bounded: an advisor can check in an advance appointment on an earlier day (SPEC §6.3 does not
  restrict it). Reserved parts are released on cancel / no-show but never consumed on completion; stock is expected to
  be corrected by the DMS inventory sync.
- The availability grid does not mark slots where the customer's vehicle is already booked elsewhere; booking one
  returns 409 `VEHICLE_ALREADY_BOOKED` (the 409 alternatives do skip them).
- Reschedule and notifications are out of scope (Reschedule is shown disabled). More in
  [System Design §10](docs/SYSTEM_DESIGN.md#10-future-work).

---

## AI Collaboration Narrative

> Draft prepared from the project log for Huy to review and edit in their own words before submission.

**Tools.** Claude Code with **Claude Opus** as design partner and orchestrator, and **Claude Sonnet** agents as
implementers, each running in an isolated git worktree. Every prompt given to an agent is archived verbatim in
[`docs/agent-briefs/`](docs/agent-briefs/); every review, defect and correction is dated in [`docs/ai-log.md`](docs/ai-log.md).

### Strategy: make the work well-scoped before any AI writes code

1. **Humans decide, AI frames.** Opus turned the open questions (which layer, stack, scope, timebox) into explicit options with
   a recommendation; I made the calls. I added the domain rules the brief did not have — the same-day express policy (express
   services only, lead time, capacity quota, parts in stock, late-arrival release) — and Opus turned them into testable rules.
2. **Spec and contracts first.** Before the first agent ran, Opus wrote what agents could not change: [`SPEC.md`](docs/SPEC.md)
   with a numbered test table (T1–T21), the shared zod contracts with fixtures that are themselves tested, the engine's type
   signatures, the router with one stub per endpoint, and ADRs.
3. **Small packages with exclusive file ownership.** Ten work packages in four waves (foundation · engine · web shell →
   read endpoints · booking · screens → observability · late-arrival · e2e · API docs/CI). Each brief lists the files the
   agent owns, what it may read, allowed dependencies, deliverables and acceptance criteria with evidence. Parallel agents
   never touched the same file, so merges were mechanical.
4. **Agents report, they don't self-certify.** Every agent ended with the same report format — acceptance criteria with
   evidence, assumptions, deviations — and was told to flag spec contradictions instead of bending tests.

### Verification: trust nothing that was not observed

- **Review every diff** against the spec before merging, and run the whole suite on `main` after each merge.
- **Mutation testing at each gate:** deliberately break the code (half-open overlap `<` → `<=`, drop the skill ranking,
  off-by-one in the quota, skip the window check, include cancelled rows on the board, make the grace period exclusive…) and
  require a test to go red. Every mutant was caught; the results are in the log.
- **Run the real thing**, not just tests: start the server, book, conflict, cancel over HTTP, read `/metrics`; drive the UI in
  a real browser and compare screenshots against the design at 1440 and 390 px.

### What the process caught (selected — details in the log)

| Found by | Problem | Outcome |
|---|---|---|
| Sonnet (engine) | A wrong expectation in Opus's own test table (T8) | Spec corrected after re-deriving by hand |
| Sonnet (API foundation) | pnpm 10 skipped the PostgreSQL package's install script → DB would not start on a fresh clone | Fixed in workspace config, verified with a clean reinstall |
| Sonnet (booking), via its own mutation check | Concurrent retries with the same idempotency key could get 409 instead of 200 | Fixed and covered by a test |
| Opus review | Booking history dropped the "Customer chose …" step shown in the design | Sent back with exact expected wording; fixed by the agent |
| Opus verification | **The test runner exited 0 even when tests failed** (an exit hook inside `embedded-postgres`) — every green build was unverified | Root-caused, fixed, proven with a deliberately failing run |
| Opus smoke test | Seed data made the default service (brake pads) unbookable on every day — no test covered it | Seed retuned; spec updated |
| Opus | Its own slips: pushing without the full suite, a `verify \| grep` that hid an exit code, a broken test rewrite | Logged; gate changed to `pnpm verify && git push` |

### How quality was ensured

Correctness lives in layers that are each tested on their own: a pure engine with property-based tests and full coverage;
database constraints proven by integration tests that try to violate them; a transaction design verified under real
concurrency and re-verified with the lock removed; and the user journeys covered end to end in a real browser. The AI wrote
most of the code; the decisions, the contracts it had to satisfy, and the evidence that it does were owned by us.
