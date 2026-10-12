# AI collaboration log

Running record for the README's *AI Collaboration Narrative*. One entry per wave: what was delegated, how it was
verified, what was caught and corrected. Agent prompts are archived verbatim in `docs/agent-briefs/`.

## Wave 0 — design & contracts (Huy + Opus, 2026-10-08)

- **Input:** challenge PDF + Claude Design bundle (`Unified Service Scheduler.html`). Opus unpacked the bundle (gzip+base64
  manifest) into `design/screens/` and read the mock logic to extract the domain model (service → required skill + allowed
  bays, technician skills, 08:00–17:00 day, 30-minute grid, UTC+7).
- **Decisions by Huy:** backend as the full layer, TypeScript end-to-end, full scope (alternatives, history, board, cancel),
  ~1 week. Huy added the same-day express policy (express-only, lead time, quota, parts check, instant confirm, late release)
  → SPEC v0.2, ADR-005. Opus decided the remaining rules on Huy's request (assignment heuristic, hours, grid).
- **Verified before relying on it:** no Docker on the dev Mac (macOS 12) → probed `embedded-postgres`: PG 18.4 starts,
  `btree_gist` loads, an overlapping `tstzrange` insert is rejected with `23P01`. Chose it over Homebrew/Testcontainers.
- **Spec self-review caught:** test case T10 originally asserted TEC-03 for an empty-day oil change, but the stated rule
  (fewest skills → busy minutes → id) yields TEC-02 — split into T10a/T10b with explicit setup.
- **Guard-rails for agents:** contracts, engine types, router, error class and clock written by Opus first; fixtures are
  validated against the schemas by tests (14 passing); every WP has exclusive file ownership.

## Wave 1 — A2 availability engine (Sonnet, merged 2026-10-08)

- **Delivered:** pure engine split into intervals / engine / assignment / alternatives / same-day; 35 unit tests incl.
  T1–T21 by id and 3 fast-check properties (300 runs each, independent minute-by-minute re-derivation); 100% line + branch
  coverage; purity grep clean.
- **The agent caught a spec bug written by Opus:** T8 expected `NO_QUALIFIED_TECHNICIAN` only up to 10:30, but a 90-minute
  job starting 11:00 or 11:30 still overlaps 08:00–12:00. Opus re-derived it by hand, agreed, and corrected SPEC T8. The
  brief had told agents to implement the rules and flag contradictions rather than bend tests — that instruction paid off.
- **Process deviation noted:** the brief asked for tests-first; the agent wrote implementation first and said so.
  Compensated by mutation testing at the gate.
- **Gate — mutation checks (Opus):** each mutant run against the suite, then reverted.

  | Mutant | Result |
  |---|---|
  | overlap `<` → `<=` (breaks half-open / back-to-back) | 4 tests fail |
  | drop "fewest skills" ranking | 3 tests fail |
  | quota `>=` → `>` (off-by-one) | 3 tests fail |
  | lead-time rounding `ceil` → `floor` | 1 test fails |

- **Accepted assumptions:** `checkWindow` does not apply `earliestStart` (booking validates lead time explicitly and returns
  `LEAD_TIME_NOT_MET`); `evaluateSameDay` still returns `earliestStart`/`quotaCap` when blocked.
- **Opus slip, fixed:** a `git add -A` in the main checkout staged the agents' worktrees (`.claude/worktrees/`) as embedded
  repos; amended before push and added to `.gitignore`.

## Wave 1 — A1 API foundation (Sonnet, merged 2026-10-08)

- **Delivered:** config, RFC 7807 error handler (DomainError, zod, `23P01` → 409, 404, safe 500), request ids, health,
  Swagger, SPEC §4 schema with a hand-written constraints migration, `time.ts` (DST-tested), repositories incl.
  `loadDayContext` and `partsAvailability`, deterministic seed, embedded-Postgres test harness (ephemeral instance on a
  random port + per-file template clones). 45 tests.
- **The agent found a real defect in an Opus-owned file:** pnpm 10 blocks dependency build scripts by default, so
  `@embedded-postgres/*`'s postinstall (ICU dylib symlinks) never ran → Postgres could not start on a fresh clone. It
  worked around it locally, did *not* edit the Opus-owned file, and reported it. Opus confirmed (`libicudata.77.dylib`
  symlink missing), added the packages to `onlyBuiltDependencies`, and verified with a clean `rm -rf node_modules` reinstall.
- **Integration check A1 × A2 (Opus):** after merging both, `db:seed` ran the background load through the real engine:
  858 appointments, 50–51% bay utilisation per dealership-day, zero constraint violations — the two independently built
  halves fitted on the first run because both coded against the Wave 0 `types.ts`.
- **Opus glue for W2:** `services/day-plan.ts` (plan resolution, alternatives, DTO mappers) with 6 integration tests.
  Opus's own test initially failed — the expected horizon date assumed October has 30 days; the code was right.

## Wave 1 — F1 web shell + Book screen (Sonnet, merged 2026-10-08)

- **Delivered:** app shell, typed API client (contract-validated, problem+json → `ApiError`), hooks for every endpoint,
  MSW handlers with a client-side port of the §5 rules and `?mock=conflict|parts|cutoff|morning` scenarios, the full Book
  screen incl. same-day states. 26 component/mock tests.
- **Honest gap in the report:** the agent could not get a browser screenshot (headless Chrome + service worker) and marked
  the 1440/390 px criterion ❌ instead of claiming it. Opus closed the gap: Playwright's bundled Chromium refuses macOS 12,
  so Opus drove the system Google Chrome via `executablePath`, captured `docs/screenshots/book-*.png` at 1440 and 390 px,
  confirmed no page-level horizontal scroll (scrollWidth = viewport) and compared against design 01 by eye. The same-day
  "morning" scenario shows earliest start 11:30, Express labels, the late-arrival notice and Marco Ortiz assigned for an
  oil change (consistent with engine test T10a).

## Wave 2 — A3 read endpoints (Sonnet, merged 2026-10-08)

- **Delivered:** reference, availability (via `resolveDayPlan` + engine — no duplicated rules), board, inventory GET/PUT
  with contract schemas on every route (so they appear in `/docs`); race-free `PUT` (single guarded `UPDATE`). 21 tests.
- **Ownership deviation, accepted:** the agent deleted A1's `stubbed route → 501` test, which by construction had to fail
  once `/dealerships` was implemented. It disclosed this instead of hiding it. Lesson for briefs: temporary scaffolding tests
  should be marked as such.
- **Gate — mutation checks:** availability ignoring `sameDay.blocked` → 2 tests fail; board including CANCELLED → 1 fails.
- **Opus slip, fixed:** root ESLint was linting agents' in-progress worktrees under `.claude/worktrees/`, and Opus's gate
  piped `pnpm verify` into `grep`, which hid the non-zero exit. Fixed the ignore list and switched gates to checking `$?`.

## Wave 2 — A4 booking command (Sonnet, merged 2026-10-08)

- **Delivered:** SPEC §6.1 transaction (advisory lock → idempotency re-check → fresh `resolveDayPlan(tx)` → vehicle overlap →
  `checkWindow` → conditional parts `UPDATE` → insert + events), `CHECK_FAILED` after rollback, `23P01` mapped by constraint
  name, list/detail/cancel, history sentences. 46 integration tests incl. 20-way concurrency, same-day quota race, parts race,
  concurrent idempotency.
- **The agent's own mutation check found a real bug:** with concurrent requests sharing an `Idempotency-Key`, some got 409
  (exclusion violation) instead of 200. Fixed by resolving the key in the error path. It also showed the advisory lock is what
  enforces the same-day quota (no constraint can count across different resources) → documented in ADR-002.
- **Opus review → one change sent back:** the agent deduplicated `SLOT_REQUESTED` per session, which dropped design 03's
  "Customer chose 13:00–15:00" line. Sent back with exact expected sentences; the agent fixed it in its own files.
- **Reported by the agent, fixed by Opus:** `Promise.all` over a transaction client in Opus's `day-plan.ts` (and A1's
  `loadDayContext`) triggers pg's "already executing a query" deprecation (an error in pg 9). Made both sequential.
- **Biggest catch of the project so far — the gate itself was broken.** While mutation-testing A4, Opus noticed a deliberately
  broken run exited **0**. Root cause: `embedded-postgres` imports `async-exit-hook`, which hooks `beforeExit` and calls
  `process.exit(0)`, overwriting vitest's `process.exitCode = 1`. Every `pnpm verify` so far would have passed even with red
  tests. Earlier gates were still valid (they were judged on the per-test pass/fail counts, and every run showed 0 failures),
  but CI would have been blind. Fix in `test/helpers/global-setup.ts` re-applies the exit code; proven with the mutant
  (exit 1) and the clean tree (exit 0).

## Wave 2 — F2 record / list / board screens (Sonnet, merged 2026-10-08)

- **Delivered:** design 03 record (cancel dialog with focus trap, `.ics` export, history timeline, stored-fields table),
  My appointments tabs, design 02 board (grid from opening hours, Express marking, Check in with live-region result, no-show
  styling), demo seed in the mock handlers. 20 new tests. This time the agent took its own Chrome screenshots using the
  `executablePath` workaround Opus put in the brief after F1.
- **Opus visual gate:** re-shot board/record/list at 1440 px (no page-level horizontal scroll) — faithful to designs 02/03.
  At 390 px the header wraps to four rows and the day-nav "next" button drops to its own line: usable, not polished →
  assigned to F3. Opus aligned its own fixture ("Customer chose 13:00–15:00") with the A4 history wording — and broke `main`
  for one commit by running only the contracts tests before pushing (a web test asserted the old text). Rule tightened:
  Opus runs full `pnpm verify` + exit code before every push, no exceptions.

## Wave 3 — A7 late-arrival policy (Sonnet, merged 2026-10-08)

- **Delivered:** check-in endpoint (inclusive 15-minute grace, same-day only), `markLateNoShow` shared with the 60 s sweeper,
  guarded `UPDATE … WHERE status='CONFIRMED' AND checked_in_at IS NULL` so check-in / cancel / sweeper races resolve to one
  outcome; reuses Opus's `releaseParts`. 10 integration tests incl. a check-in vs sweeper race.
- **Good judgement by the agent:** the late NO_SHOW transition is committed *before* the 409 is thrown — throwing inside
  the transaction would have rolled the release back and left the slot blocked.
- **Gate — mutation checks (exit codes now trustworthy):** grace boundary `>` → `>=` → exit 1 (1 test); late rule applied to
  advance bookings → exit 1 (1 test).
- **Opus slip #3, and a flaky-test finding:** the post-merge `pnpm verify` exited 1 (12 web tests timed out at 5 s) but Opus's
  command chained the push with `;`, so it pushed anyway. Investigation: load average 242 while A5 and F3 ran suites/e2e in
  parallel; the same web suite passed 46/46 on an isolated re-run → environmental flakiness, code on `main` was correct.
  Fixes: (1) pushes are now only ever `pnpm verify … && git push`; (2) harden web test timeouts after F3 merges (F3 owns
  `apps/web` right now — avoiding a merge conflict).

## Wave 3 — A5 observability (Sonnet, merged 2026-10-08) + Opus runtime smoke test

- **Delivered:** prom-client registry and `/metrics` (HTTP histogram by route *pattern*, `booking_attempts_total{outcome,reason,channel}`,
  reserve and lock-wait histograms, availability timing, no-show counter), OpenTelemetry SDK only when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is set, manual `booking.reserve` / `availability.compute` spans without PII, pino trace
  correlation, `docs/observability.md` with PromQL and alerts. Services depend on a vendor-free `Telemetry` interface.
- **Opus glue:** A5 could not see A7's code, so Opus wired `noShowReleased` into the sweeper and the late check-in path.
- **Runtime smoke test (first time the real server ran end to end):** booked, conflicted, cancelled over HTTP; `/metrics`
  and the structured `booking attempt` log line were correct. **It exposed a demo-breaking seed problem no test covered:**
  the "50% of all bay-minutes" target ignored that wash/EV bays are rarely usable, so general lifts and the two Brakes
  technicians were saturated — brake pad replacement (the Book screen's default) had 0 of 15 slots on every day. Opus
  changed the seed to ~30% bay utilisation with a 50% per-technician cap and updated SPEC §7; after re-seeding every
  service shows a realistic mix (e.g. brake 6 available / 9 rejected for mixed reasons).

## Wave 3 — F3 web on real API + e2e (Sonnet, merged 2026-10-08)

- **Delivered:** real-API mode with retry panels, 390 px header (≤ 2 rows) and board polish, Playwright e2e with its own
  stack (ephemeral embedded Postgres + API with pinned `CLOCK_OVERRIDE` + Vite, browser clock pinned to match), 13 specs
  incl. screenshots at 1440/390 px regenerated into `docs/screenshots/`. `PW_CHROME_PATH` supports this macOS 12 machine.
- **Correctly blocked, then unblocked by integration:** the agent could not exercise Check in because A7 had not merged into
  its branch; instead of faking it, the spec probed for a 501 and skipped. After merging both on `main`, Opus ran
  `pnpm e2e`: 13/13 green including Check in.
- **Merge:** `pnpm-lock.yaml` conflicted (A5 and F3 both added dependencies); resolved by pnpm, confirmed with
  `pnpm install --frozen-lockfile`.
- **Flakiness work (Opus):** web suites got 20 s test timeouts and a 5 s Testing Library async timeout (they had timed out at
  load average 242). A5's tracing unit test slept fixed 50/10 ms waiting for asynchronous SDK registration/export and failed
  under load; replaced with `vi.waitFor` on the real condition. Opus's first rewrite was itself wrong — it read
  `isRecording()` *after* `span.end()`, which is always false — caught because it failed deterministically; fixed; 6/6 runs green.

## Wave 4 — independent review + fresh-clone run-through (2026-10-09)

- **Fresh clone from GitHub, following only the README:** `corepack enable` → `pnpm install` → `db:up` → migrate → seed →
  `dev:real`. Health ready, Swagger and `/metrics` up; book 201 → replay 200 → other vehicle 409 `FULLY_BOOKED` with 5
  alternatives → same vehicle 409 `VEHICLE_ALREADY_BOOKED`; metrics counted each outcome. No README fix needed.
- **Independent reviewer (Sonnet, read-only, fresh context, told to confirm each finding by experiment):** found no
  double-booking or parts over-reservation path, and five real defects, all confirmed with a throwaway test:
  1. `LocalDate` accepted impossible dates (`2027-02-30`) → luxon threw → **500** on board / availability / booking.
  2. A reused `Idempotency-Key` with a *different* request returned 200 with the original appointment — the client would
     believe its new booking succeeded, and another customer's key reuse would **disclose the first customer's booking**.
  3. Cancel ignored check-in (a customer on site could be cancelled and their parts released), and losing a race to a
     no-show release returned 200 instead of 409.
  4. Same-day lead time truncated seconds: at 09:30:30 an 11:30 start was accepted 30 s inside the 2 h lead.
  5. 409 alternatives could offer windows where the same vehicle is already booked (they would then fail with
     `VEHICLE_ALREADY_BOOKED`).
- **Opus decisions and fixes:** calendar refine in contracts (→ 400); replay only for an identical request, else new
  422 `IDEMPOTENCY_KEY_REUSED`; cancel guarded on `checked_in_at IS NULL` with the lost-race path → 409; `nowMin` rounds up
  a started minute; alternatives post-filtered against the vehicle's confirmed intervals (engine asked for enough extra
  candidates to cover every start a booking can block). SPEC §5.4 / §6.1 / §6.2 updated, OpenAPI regenerated.
  Remaining review items (check-in not time-bounded, parts never consumed, grid not vehicle-aware) → README limitations.
- **Gate — mutation check:** source reverted, new tests kept → 8/8 new tests fail, exit 1; restored → `pnpm verify` green.
- **W4-D1 docs consistency pass (Sonnet):** checked every claim, path, script, port and link in README / SYSTEM_DESIGN /
  cURL / `.http` against HEAD; fixed stale test counts and documented the new 422 / 400 / 409 rules. It caught a real stale
  step: the walkthrough's final "tidy up" cancel now returns 409 because that appointment is checked in. It also flagged a
  dead `test.skip` probe for the Wave 0 check-in stub in e2e, which Opus removed; `pnpm e2e` 13/13 green.

## Wave 5 — showcase polish (2026-10-12)

Plan approved by Huy: reschedule in place (S7, ADR-006), measurable quality evidence, Docker + Grafana + k6, CI, docs.
Auth and technician shifts stay future work. Executed through the project agents in worktrees; Opus gates and merges.

- **W5-0b (db-architect):** `loadDayContext({ excludeAppointmentId })` — one `ne(id)` in the WHERE, no migration.
  Agent's mutation check: filter dropped → exclusion test red, 9 others green. Opus re-ran the file 10/10 + typecheck.
  Scope note: the db-architect definition only owns `src/db/**`, the brief also gave it the test file; accepted, future
  DB briefs state the exception explicitly.
- **W5-Q1 (sched-qa):** coverage thresholds (engine hard 100%, global floor = measured − 2), Stryker on `src/domain/**`
  (unit tests only, ~20 s). The agent's new tests lifted the mutation score **86.81% → 98.77%** (30 → 3 survivors; the 4
  left are argued equivalent in `docs/quality.md`). **Opus reproduced both numbers** in the worktree (318 killed /
  4 timeout / 3 survived / 1 no-cov; API 94.16% statements). Out-of-scope `vitest.unit.config.ts` accepted (Stryker needs
  a config without the Postgres global setup); Opus added `reports/` and `.stryker-tmp/` to the eslint ignores.
- **Deny rules vs. orchestrator:** the project's `Edit(docs/SPEC.md)` / `Edit(packages/contracts/**)` deny rules also block
  Opus. Opus did not route around them through the shell; Huy lifts them temporarily for the SPEC v0.3 edit.

- **W5-0a (Opus):** SPEC v0.3 §6.5 (R1–R15), contracts, `day-plan` `excludeAppointmentId` / `partsHeld`, ADR-006.
  Mutation: exclusion dropped from the vehicle-busy filter → the new day-plan test red.
- **W5-F4 (frontend-dev):** reschedule screen on MSW. Gate: mutation "never mark Current" → the Current-slot test red.
  Three small out-of-scope but backward-compatible props (`SlotGrid.currentStart`, `Summary.confirmLabel`, a CSS rule).
- **W5-A8 (backend-dev):** reschedule in place. **Gate caught a real gap:** the agent's own mutation (b) — lock only the
  new day — left every test green. Opus explained what the old-day lock is for (two reschedules of the *same*
  appointment to different days lock disjoint keys, both pass, last writer wins, SAME_DAY parts double-released) and sent
  it back. The agent added **R15b**, made it deterministic by holding the source-day lock from an outside transaction
  while both requests pre-read; Opus reproduced: lock removed → both R15b tests red (one variant even 500s), restored → green.
- **W6-O1 (backend-dev):** Docker images (multi-arch, non-root, healthchecks), compose `app`/`obs`, Prometheus,
  provisioned Grafana, k6 + `verify-invariants.sql` (proven to detect an overlap with the constraints dropped).
  Found: Jaeger OOM-killed at 100% sampling under ~700 req/s → Opus added `OTEL_TRACES_SAMPLER=parentbased_traceidratio`
  (10%) to compose. Found: `reference = nextval % 10000` can collide per date at scale → README limitation.
- **Integration (Opus):** `pnpm e2e` on the real API first failed 3/16 — **test-data, not app**: the grid is not
  vehicle-aware, so the first AVAILABLE slot overlapped VEH-01 bookings left by earlier specs (409
  `VEHICLE_ALREADY_BOOKED`), and the first "Upcoming" row was checked in (no Reschedule button). Fixed with
  `firstSlotFreeForVehicle()` + explicit slot clicks; a first attempt that changed `firstOpenSlot` itself broke the Book
  screenshot (the UI auto-selects the first AVAILABLE) and was reverted. → **16/16 green**. Docker stack with merged code:
  book → reschedule via API in containers, `reschedule_attempts_total` scraped by Prometheus, Grafana healthy, torn down.

## Parked (decide later)
- Board "incoming request / rejected / reserved" panels from the mock.
