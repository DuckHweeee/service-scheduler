# Delivery Plan — Opus orchestrates, Sonnet agents implement

Companion to [`SPEC.md`](SPEC.md). Timebox: ~1 week. Chosen layer: **backend (full)**; web = client harness
built from the design (lighter tests). Stack: TypeScript end-to-end.

## 0. Operating model

| Role | Responsibility |
|---|---|
| **Huy** | Product owner + final approver. Answers spec gaps, approves each merge, owns the AI narrative and video. |
| **Opus (orchestrator)** | Writes/maintains SPEC + shared contracts, writes each agent brief, reviews every diff against acceptance criteria, merges, keeps `docs/ai-log.md`. Never delegates shared files. |
| **Sonnet agents** | Implement exactly one work package (WP) each, in an isolated git worktree, inside the files they own. |

Rules every brief inherits (also in root `CLAUDE.md`):

1. **File ownership is exclusive.** A WP may only create/modify the paths listed under *Owns*. Need a change
   elsewhere → stop and report it; Opus makes shared changes.
2. **SPEC is read-only** for agents. Gap or contradiction → report, don't invent.
3. **Definition of done** = all acceptance criteria ticked + `pnpm verify` green
   (`typecheck`, `lint`, `test` for the touched packages) + a final report in the format below.
4. No new runtime dependency outside the WP's *Allowed deps* without asking.
5. Tests first for domain logic: write the SPEC test-table cases before the implementation.

Agent final report format:
```
## Summary            (what was built, 3–6 bullets)
## Acceptance criteria (each item: ✅ / ❌ + evidence: test name or command output)
## Assumptions made   (anything not in SPEC — should be empty or tiny)
## Deviations / open questions
## Files changed
```

Verification gate per WP (Opus, before merge): read the full diff → run `pnpm verify` in the worktree →
spot-check against SPEC → for test-heavy WPs, **mutation check** (break the code on purpose, e.g. drop an
exclusion constraint or flip `<` to `<=`, and confirm a test goes red) → log findings in `docs/ai-log.md` →
Huy approves → merge.

## 1. Repository layout (created in Wave 0)

```
service-scheduler/
├─ CLAUDE.md                     agent conventions, commands, ownership rules
├─ package.json / pnpm-workspace.yaml / tsconfig.base.json / eslint + prettier
├─ docker-compose.yml            postgres:16 (+ jaeger profile) — for reviewers with Docker
├─ .env.example
├─ packages/contracts/           zod schemas + inferred types + fixtures  (Opus-owned)
├─ apps/api/                     Fastify + Drizzle + Postgres
│  ├─ src/domain/availability/   pure engine (types.ts fixed in W0)
│  ├─ src/domain/time.ts         tz conversion (local date+minutes ⇄ Instant)
│  ├─ src/db/                    schema, client, repositories
│  ├─ src/routes/                one module per resource
│  ├─ src/services/              booking, cancellation
│  ├─ drizzle/                   migrations (incl. hand-written EXCLUDE SQL)
│  └─ test/                      unit / integration (real Postgres)
├─ apps/web/                     React + Vite + TanStack Query + React Router
├─ design/screens/               extracted design (reference only)
└─ docs/  SPEC.md · PLAN.md · SYSTEM_DESIGN.md · adr/ · agent-briefs/ · ai-log.md · openapi.yaml
```

Database runtime: **`embedded-postgres` (PostgreSQL 18 binaries from npm, incl. `btree_gist`)** — no Docker or
Homebrew needed; verified on this Mac (Intel, macOS 12). `pnpm db:up` starts a persistent local instance on :54329;
integration tests start an ephemeral instance per run (or use `TEST_DATABASE_URL` if set). `docker-compose.yml`
(postgres:18) remains for reviewers who prefer Docker. Code is pushed to a private GitHub repo after every wave.

## 2. Waves

```
W0  Opus + Huy  ── foundation & contracts ───────────────────────────────┐
W1  ║ A1 api-foundation ║ A2 availability-engine ║ F1 web-shell+Book(MSW) ║  parallel
W2  ║ A3 read-endpoints ║ A4 booking-command     ║ F2 web Record/List/Board ║  parallel
W3  ║ A5 observability  ║ A7 late-arrival policy ║ F3 web↔real API + e2e ║ → A6 api-docs
W4  Opus + Huy  ── review, SYSTEM_DESIGN, README, AI narrative, video ───┘
```

| Day | Wave | Exit criterion |
|---|---|---|
| 1 | W0 | contracts + SPEC frozen, repo boots, `pnpm verify` green on empty packages |
| 2 | W1 | engine passes T1–T14; API boots with migrations + seed; Book screen works on MSW |
| 3–4 | W2 | all endpoints implemented, concurrency test green; all 4 screens on MSW |
| 5 | W3 | web runs on real API, Playwright smoke green, /metrics + traces visible |
| 6 | W4 | docs complete, `/code-review` pass, fresh-clone run-through |
| 7 | — | video + buffer |

---

## W0 — Foundation (Opus + Huy, not delegated)

- [ ] `git init`, `.gitignore`, corepack pnpm, workspace, tsconfig strict, eslint/prettier, vitest workspace,
      root scripts: `dev`, `verify`, `db:migrate`, `db:seed`, `test:int`.
- [ ] `embedded-postgres` scripts: `db:up` (persistent, `.pgdata/`), `db:down`; test global-setup starts an ephemeral one.
- [ ] `docker-compose.yml` (postgres:18, jaeger all-in-one under profile `obs`), `.env.example`.
- [ ] Private GitHub repo created and pushed.
- [ ] `packages/contracts`: all enums, request/response zod schemas from SPEC §6, problem+json schema,
      JSON fixtures (dealerships, service types, vehicles, availability day, appointment detail, board).
- [ ] `apps/api/src/domain/availability/types.ts` exactly as SPEC §5.1 (signatures only).
- [ ] `apps/api` + `apps/web` empty skeletons that typecheck; route stubs returning 501 for every SPEC route
      (so W2 agents never edit the router).
- [ ] `CLAUDE.md`, ADRs 001–004 (see §4), `docs/ai-log.md` started, briefs for W1 written to `docs/agent-briefs/`.

---

## W1 (parallel)

### A1 — API foundation
- **Goal:** a bootable Fastify service with DB, migrations, seed, error model and the shared data-access layer.
- **Depends:** W0. **Model:** Sonnet. **Worktree:** yes.
- **Owns:** `apps/api/src/{app.ts,server.ts,config.ts}`, `apps/api/src/plugins/**`, `apps/api/src/db/**`,
  `apps/api/drizzle/**`, `apps/api/scripts/seed.ts`, `apps/api/test/helpers/**`, `apps/api/test/int/db.*.test.ts`,
  `apps/api/src/routes/health.ts`.
- **Allowed deps:** fastify, fastify-type-provider-zod, @fastify/swagger(+ui), @fastify/cors, drizzle-orm,
  drizzle-kit, pg, pino, luxon, embedded-postgres.
- **Deliverables:**
  1. Config via env (zod-validated): `DATABASE_URL`, `PORT`, `LOG_LEVEL`, `CORS_ORIGIN`.
  2. Drizzle schema + migrations matching SPEC §4 **exactly**, incl. hand-written SQL for `btree_gist`,
     generated `during` column and the 3 exclusion constraints.
  3. Problem+json error handler (zod errors → 400 `VALIDATION_ERROR`; `DomainError(code,status)` class → mapped).
  4. Request id (`x-request-id` in/out), pino JSON logging with `reqId`.
  5. `src/domain/time.ts`: `toLocalMinutes`, `fromLocal(date, minutes, tz) → ISO with offset`, `localToday(tz, now)`,
     `isWorkingDay`. Unit-tested incl. a DST zone (Europe/London) even though seed is UTC+7.
     `src/clock.ts`: injectable `Clock` (`systemClock`, `fixedClock(iso)`, honours `CLOCK_OVERRIDE`).
  6. Repository `loadDayContext(db|tx, dealershipId, localDate, opts?: { sameDay }) → DayContext` (confirmed
     appointments only; fills `sameDayBusy` from `channel = SAME_DAY`), reference lookups (dealership, service type,
     customer, vehicle) and `partsAvailability(db|tx, dealershipId, serviceTypeCode, vehicleModel)` →
     `{ available: boolean, lines: {sku, qty}[] }` (model-specific rows override NULL rows).
  7. Seed script per SPEC §7 (background load generated through `computeSlots` — import from A2's module path;
     until A2 merges, code against `types.ts` and a local stub, Opus wires it at merge).
  8. `/health/live`, `/health/ready` (DB ping), `/docs` (Swagger UI).
  9. Test helper: per-test-file fresh schema on `TEST_DATABASE_URL` or Testcontainers fallback.
- **Acceptance criteria:**
  - [ ] `pnpm db:migrate && pnpm db:seed` on an empty DB succeeds twice in a row (idempotent).
  - [ ] Integration test: inserting two overlapping CONFIRMED appointments for the same technician fails with `23P01`;
        same for bay and vehicle; a CANCELLED overlap is allowed; back-to-back `[10:00,12:00)`+`[12:00,13:00)` allowed.
  - [ ] Integration test: technician from DLR-02 on a DLR-01 appointment is rejected by composite FK.
  - [ ] Integration test: `inventory.reserved > on_hand` is rejected by CHECK; `partsAvailability` honours model override
        and DLR-02 `FLT-OIL-CX22 = 0`.
  - [ ] `loadDayContext` test: returns busy intervals in local minutes, excludes cancelled and other days.
  - [ ] Unknown route → 404 problem+json; malformed body → 400 problem+json with `errors[]`.
- **Out of scope:** business endpoints (stubs stay 501), metrics/tracing.

### A2 — Availability engine (pure)
- **Goal:** implement SPEC §5 with exhaustive unit tests. This is the heart of R2.
- **Depends:** W0 (`types.ts`). **Owns:** `apps/api/src/domain/availability/**` (except `types.ts`),
  `apps/api/test/unit/availability/**`. **Allowed deps:** none.
- **Deliverables:** `computeSlots`, `checkWindow`, `findAlternatives`, assignment ranking, `evaluateSameDay`,
  `sameDayQuotaCap`; test fixtures builder
  (`makeDay({ busy: { 'TEC-01': ['10:30-11:00'] } })` style, times as strings for readability).
- **Acceptance criteria:**
  - [ ] Every row T1–T21 of SPEC §5.5 is a named test (`it('T5 partial overlap rejects …')`).
  - [ ] Property test (fast-check allowed as devDep): for random busy sets, every `AVAILABLE` slot's proposed bay and tech
        are truly free and qualified; every non-available status is justified.
  - [ ] 100% line + branch coverage on the module (`vitest --coverage`).
  - [ ] No import of Date, DB, Fastify or luxon inside the module.

### F1 — Web shell + Book screen (on MSW)
- **Goal:** pixel-faithful Book flow (design 01) running entirely on mocks typed by `@scheduler/contracts`.
- **Depends:** W0. **Owns:** `apps/web/**` except `apps/web/src/screens/{record,list,board}/**`.
- **Allowed deps:** react, react-dom, react-router-dom, @tanstack/react-query, msw, @fontsource-variable/archivo,
  @fontsource/ibm-plex-mono, vitest, @testing-library/react, uuid.
- **Deliverables:** tokens.css (SPEC §8), app shell (header, nav with `aria-current`, user chip), typed API client
  (`VITE_API_URL`; problem+json → typed error), MSW handlers built from contracts fixtures **including a
  409 scenario** (toggle via `?mock=conflict`) and the three `sameDay.blocked` scenarios, Book screen with all states
  from SPEC §8 incl. same-day notice, Express labels, "no open time this day" panel and confirmation panel.
- **Acceptance criteria:**
  - [ ] All states in design 01 reachable: default, slot selected, checking, confirmed, 409 with alternatives, no-open-day,
        plus same-day: Today chip, notice, Express slots, quota-full slots, each `sameDay.blocked` panel.
  - [ ] EV vehicle hides OIL_CHANGE; ICE vehicle hides EV_BATTERY_CHECK.
  - [ ] Keyboard-only booking works; buttons use `aria-pressed`; disabled slots have `aria-label` with reason.
  - [ ] Component tests: slot status → label/disabled mapping; changing service clears slot and auto-selects first open.
  - [ ] Layout holds at 1440px and 390px wide.
- **Out of scope:** other screens (placeholders only), real API.

---

## W2 (parallel; starts after W1 merged)

### A3 — Read endpoints
- **Owns:** `apps/api/src/routes/{reference,availability,board,inventory}.ts`,
  `apps/api/src/services/{availability,board,inventory}.ts`, `apps/api/test/int/{reference,availability,board,inventory}.test.ts`.
- **Deliverables:** `GET /dealerships`, `/service-types`, `/customers/{id}`, `/customers/{id}/vehicles`,
  `/dealerships/{id}/availability` (incl. same-day evaluation via `evaluateSameDay`), `/dealerships/{id}/board`,
  `GET/PUT /dealerships/{id}/inventory[/{sku}]` per SPEC §6. Export `buildAvailability(...)` from
  `services/availability.ts` — A4 reuses it for alternatives and same-day checks.
- **Acceptance criteria:**
  - [ ] Availability for a seeded day matches `computeSlots` on the same `DayContext` (golden test).
  - [ ] Date outside horizon → 422 `OUTSIDE_BOOKING_HORIZON`; unknown dealer/service → 404.
  - [ ] `proposed` resolves ids to names; times rendered with dealership offset.
  - [ ] Board returns all bays and techs (even idle) with their confirmed appointments sorted by start.
  - [ ] DLR-03 + WHEEL_ALIGNMENT → every slot `NO_QUALIFIED_TECHNICIAN`.
  - [ ] Same-day (fixed clock 09:10): first slot 11:30, `isExpress: true`; brake today → `blocked: SERVICE_NOT_EXPRESS`;
        DLR-02 + OIL_CHANGE + VEH-01 today → `PARTS_UNAVAILABLE`; clock 15:20 → `PAST_CUTOFF`; tomorrow → `sameDay: null`.
  - [ ] OIL_CHANGE + VEH-02 (EV) → 422 `SERVICE_NOT_APPLICABLE`.
  - [ ] `PUT inventory` to 0 makes same-day oil change `PARTS_UNAVAILABLE`; setting below `reserved` → 409.

### A4 — Booking command (the critical path)
- **Owns:** `apps/api/src/routes/appointments.ts`, `apps/api/src/services/{booking,cancellation,appointment-query,history}.ts`,
  `apps/api/test/int/{booking,cancel,appointments,concurrency}.test.ts`.
- **Deliverables:** SPEC §6.1 transaction exactly (advisory lock → in-tx re-check → parts reservation for same-day →
  insert + events → commit), idempotency key, vehicle overlap rule, alternatives on 409, list/detail/cancel (§6.2,
  releases parts), history `summary` strings.
- **Note:** A3 runs in parallel; until it merges, import `buildAvailability` from `services/availability.ts`
  against the signature stub Opus writes in W0.
- **Acceptance criteria:**
  - [ ] Happy path: 201, row persisted with the engine-chosen tech/bay, 3 success events + `SLOT_REQUESTED`.
  - [ ] Unavailable slot → 409 with `reason` and ≤5 `alternatives`, `CHECK_FAILED` event persisted although tx rolled back.
  - [ ] **Concurrency:** 20 parallel requests for the same window where capacity is 1 → exactly 1×201, 19×409, and DB has
        exactly 1 confirmed row. Capacity 2 (two qualified techs + two bays) → exactly 2×201.
  - [ ] Same `Idempotency-Key` twice → one row, second call 200 with same reference.
  - [ ] Vehicle already booked in an overlapping window at another dealership → 409 `VEHICLE_ALREADY_BOOKED`.
  - [ ] Validation: misaligned start (10:15), outside hours (16:00 for 120m), weekend, past/too-far date, vehicle not owned.
  - [ ] Cancel frees the slot (same window bookable again); cancelling a past appointment → 409; double cancel → 200.
  - [ ] Detail returns history in order with summaries matching design 03 wording.
  - [ ] Same-day: booking reserves parts (inventory.reserved +1 per line), channel `SAME_DAY`; cancel releases them;
        non-express → 422; before lead time → 422 `LEAD_TIME_NOT_MET`.
  - [ ] Same-day quota: 10 parallel same-day requests for overlapping windows with free resources → exactly `quotaCap` succeed.
  - [ ] Parts race: stock 1, two parallel same-day oil changes at non-overlapping times → exactly 1×201, 1×409 `PARTS_UNAVAILABLE`.
  - [ ] Mutation check documented in report: with the advisory lock removed the concurrency test still never
        double-books (constraint catches it) — proves defence in depth.

### F2 — Record, List and Board screens (on MSW)
- **Owns:** `apps/web/src/screens/{record,list,board}/**`, plus additions to `apps/web/src/mocks/handlers/{appointments,board}.ts`.
- **Deliverables:** design 03 (linked entities, stored fields table, "How it was booked" timeline, Cancel with an
  in-page confirmation dialog — never `window.confirm`; Add to calendar = client-side `.ics` download; Reschedule
  rendered disabled with "Coming soon"), My appointments list (upcoming / past / cancelled / no-show), design 02 board
  (CSS grid `210px repeat(18, minmax(52px,1fr))`, bays then technicians, dealership select, prev/today/next,
  blocks link to records, legend, "Express" tag on same-day blocks, **Check in** action (calls the check-in endpoint;
  shows `LATE_ARRIVAL` result), NO_SHOW struck-through). The "incoming request / rejected / reserved" panels from the
  mock are **not** built (parked).
- **Acceptance criteria:** all screens reachable from nav; board scrolls horizontally at 390px; cancel flow updates
  record + list via query invalidation; component test for timeline block placement (start/end → grid columns).

---

## W3

### A5 — Observability (after A4 merged)
- **Owns:** `apps/api/src/observability/**`, `apps/api/src/instrumentation.ts`; may add one-line hooks in
  `services/booking.ts` and `app.ts` (listed in report).
- **Deliverables:** OpenTelemetry Node SDK (http, fastify, pg auto-instrumentation; OTLP exporter, disabled unless
  `OTEL_EXPORTER_OTLP_ENDPOINT` set), manual spans `availability.compute`, `booking.reserve`; prom-client `/metrics`:
  `http_request_duration_seconds`, `booking_attempts_total{outcome,reason}`, `booking_reserve_duration_seconds`,
  `availability_compute_duration_seconds`; trace id injected into logs.
- **Acceptance:** `/metrics` shows counters moving after a booking + a 409; trace visible in Jaeger (`docker compose --profile obs`) or
  console exporter; test asserting counters increment.

### F3 — Web on real API + e2e
- **Owns:** `apps/web/**` (fixes only), `e2e/**`. **Deliverables:** `VITE_USE_MOCKS=false` path, loading/error states,
  Playwright: (1) book happy path → record page → cancel; (2) forced conflict (book same slot from API first) → alternatives shown.

### A7 — Late-arrival policy (after A4 merged)
- **Owns:** `apps/api/src/routes/check-in.ts`, `apps/api/src/services/{check-in,no-show-sweeper}.ts`,
  `apps/api/test/int/{check-in,no-show}.test.ts`; one-line registration of the sweeper in `server.ts` (listed in report).
- **Deliverables:** SPEC §6.3 — check-in endpoint, `releaseLateSameDay(now)`, 60 s interval (off when `NODE_ENV=test`).
- **Acceptance:** check-in at start+10 → 200 `CHECKED_IN`; same-day at start+16 → 409 `LATE_ARRIVAL`, status `NO_SHOW`,
  parts released, window bookable again; advance booking at start+30 → 200; sweeper marks only unchecked, same-day,
  past-grace rows; double check-in → 409 `APPOINTMENT_NOT_ACTIVE`.

### A6 — API docs (after A3/A4/A7)
- **Owns:** `docs/openapi.yaml` (exported from running app), `docs/requests.http`, `docs/curl-examples.md`.

---

## W4 — Review & story (Opus + Huy)

- `/code-review` on the full branch; fix or log findings.
- Fresh-clone run-through following only the README (both brew-Postgres and docker-compose paths).
- `docs/SYSTEM_DESIGN.md`: architecture diagram (mermaid), components, data-flow sequence for booking (incl. 409 path),
  tech choices + justifications, observability strategy, assumptions (SPEC §2), scalability notes
  (stateless API → horizontal scale; per-dealership-day lock; read replicas for availability; partitioning
  appointments by dealership), **GenAI in design** section.
- README: build/run/test + **AI Collaboration Narrative** (Huy writes it from `docs/ai-log.md`: strategy = spec-first +
  exclusive ownership + parallel worktrees; verification = gates, mutation checks, concurrency test; concrete
  examples of AI output that was rejected/corrected).
- Video outline (5–10 min) mapped to the PDF's 5 required points.

## 3. Risks

| Risk | Mitigation |
|---|---|
| No Docker on macOS 12 | `embedded-postgres` (verified: PG 18.4 + btree_gist + EXCLUDE on this Mac); compose file for reviewers |
| Clock-dependent same-day logic is flaky | injectable `Clock`, `CLOCK_OVERRIDE` for demos, engine takes `nowMin` as input |
| Parallel agents collide | exclusive *Owns* lists; router + contracts + types pre-created by Opus in W0 |
| Timezone bugs | single `time.ts` module, DST-zone tests, engine works in local minutes only |
| Agents drift from design | design HTML in repo + tokens in SPEC + screen-state checklist in AC |
| "Tests that test nothing" | mutation checks at each gate; concurrency test asserts DB row count, not just status codes |
| Scope creep | anything not in SPEC → `docs/ai-log.md` "parked" list, decided by Huy |

## 4. ADRs to write in W0

- ADR-001 Backend as the implemented layer; web as client harness.
- ADR-002 Double-booking prevention: advisory lock per dealership-day + Postgres exclusion constraints.
- ADR-003 Deterministic resource assignment (least-flexible technician, preferred bay type).
- ADR-004 Local-time API contract (`date` + `startTime`) with tz-aware storage.
- ADR-005 Same-day express booking policy (express-only, lead time, quota, parts reservation, late release).
